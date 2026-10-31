import { Router } from 'express';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import sql from 'mssql';
import { z } from 'zod';
import { getPool } from '../database.js';

export const authRouter = Router();
const signupSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(254).optional().or(z.literal('')),
  phone: z.string().trim().optional().or(z.literal('')),
  password: z.string().min(8).max(128),
  confirmPassword: z.string().min(8).max(128)
}).refine(v => Boolean(v.email || v.phone), { message: 'Email or phone is required.' })
  .refine(v => v.password === v.confirmPassword, { path: ['confirmPassword'], message: 'Passwords do not match.' });
const signinSchema = z.object({ identifier: z.string().trim().min(3).max(254), password: z.string().min(8).max(128) });
const hashToken = token => crypto.createHash('sha256').update(token).digest();
const phoneNumber = value => {
  const digits = String(value || '').replace(/\D/g, '');
  const national = digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;
  return /^[6-9]\d{9}$/.test(national) ? '+91' + national : null;
};
const publicUser = row => ({ id: row.user_id, fullName: row.full_name, email: row.email, phone: row.phone_e164 });
function setSessionCookie(res, token) {
  const secure = process.env.NODE_ENV === 'production';
  res.setHeader('Set-Cookie', `clivelle_session=${token}; Max-Age=2592000; Path=/; HttpOnly; SameSite=${secure ? 'None; Secure' : 'Lax'}`);
}
function clearSessionCookie(res) {
  const secure = process.env.NODE_ENV === 'production';
  res.setHeader('Set-Cookie', `clivelle_session=; Max-Age=0; Path=/; HttpOnly; SameSite=${secure ? 'None; Secure' : 'Lax'}`);
}
function readToken(req) {
  const authorization = req.get('authorization') || '';
  const bearer = authorization.match(/^Bearer\s+([A-Za-z0-9_-]+)$/i)?.[1];
  if (bearer) return bearer;
  return req.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith('clivelle_session='))?.slice('clivelle_session='.length) || null;
}
async function issueSession(pool, userId, res) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  await pool.request()
    .input('userId', sql.UniqueIdentifier, userId)
    .input('tokenHash', sql.VarBinary(64), hashToken(token))
    .input('expiresAt', sql.DateTime2, expiresAt)
    .query('INSERT dbo.AuthSessions(user_id,refresh_token_hash,expires_at) VALUES(@userId,@tokenHash,@expiresAt)');
  setSessionCookie(res, token);
  return { token, expiresAt: expiresAt.toISOString() };
}
export async function requireUser(req, res, next) {
  try {
    const token = readToken(req);
    if (!token) return res.status(401).json({ error: { code: 'AUTH_REQUIRED', message: 'Sign in is required.' } });
    const pool = await getPool();
    const result = await pool.request()
      .input('tokenHash', sql.VarBinary(64), hashToken(token))
      .query(`SELECT TOP (1) u.user_id,u.full_name,u.email,u.phone_e164,s.session_id
        FROM dbo.AuthSessions s INNER JOIN dbo.Users u ON u.user_id=s.user_id
        WHERE s.refresh_token_hash=@tokenHash AND s.revoked_at IS NULL
          AND s.expires_at>SYSUTCDATETIME() AND u.account_status='active'`);
    if (!result.recordset[0]) return res.status(401).json({ error: { code: 'AUTH_REQUIRED', message: 'Your session has expired. Please sign in again.' } });
    req.user = result.recordset[0];
    req.sessionId = result.recordset[0].session_id;
    req.sessionTokenHash = hashToken(token);
    next();
  } catch (error) { next(error); }
}

authRouter.post('/signup', async (req, res, next) => {
  const parsed = signupSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: { code: 'INVALID_SIGNUP', message: 'Check your name, email or phone and password.', details: parsed.error.flatten().fieldErrors } });
  const email = parsed.data.email ? parsed.data.email.toLowerCase() : null;
  const phone = parsed.data.phone ? phoneNumber(parsed.data.phone) : null;
  if (parsed.data.phone && !phone) return res.status(400).json({ error: { code: 'INVALID_PHONE', message: 'Enter a valid 10-digit Indian mobile number.' } });
  try {
    const pool = await getPool();
    const existing = await pool.request().input('email', sql.NVarChar(254), email).input('phone', sql.VarChar(16), phone)
      .query('SELECT TOP (1) user_id FROM dbo.Users WHERE (@email IS NOT NULL AND email=@email) OR (@phone IS NOT NULL AND phone_e164=@phone)');
    if (existing.recordset.length) return res.status(409).json({ error: { code: 'ACCOUNT_EXISTS', message: 'An account already exists with these details. Please sign in instead.' } });
    const passwordHash = await bcrypt.hash(parsed.data.password, 12);
    const created = await pool.request()
      .input('name', sql.NVarChar(120), parsed.data.fullName)
      .input('email', sql.NVarChar(254), email)
      .input('phone', sql.VarChar(16), phone)
      .input('passwordHash', sql.NVarChar(255), passwordHash)
      .query('INSERT dbo.Users(full_name,email,phone_e164,password_hash) OUTPUT INSERTED.user_id,INSERTED.full_name,INSERTED.email,INSERTED.phone_e164 VALUES(@name,@email,@phone,@passwordHash)');
    const user = created.recordset[0];
    const session = await issueSession(pool, user.user_id, res);
    return res.status(201).json({ data: { user: publicUser(user), ...session } });
  } catch (error) {
    if (error.number === 2601 || error.number === 2627) return res.status(409).json({ error: { code: 'ACCOUNT_EXISTS', message: 'An account already exists with these details. Please sign in instead.' } });
    next(error);
  }
});

authRouter.post('/signin', async (req, res, next) => {
  const parsed = signinSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: { code: 'INVALID_SIGNIN', message: 'Enter your email or phone and password.' } });
  const raw = parsed.data.identifier.trim();
  const email = raw.includes('@') ? raw.toLowerCase() : null;
  const phone = email ? null : phoneNumber(raw);
  if (!email && !phone) return res.status(400).json({ error: { code: 'INVALID_IDENTIFIER', message: 'Enter a valid email address or 10-digit Indian mobile number.' } });
  try {
    const pool = await getPool();
    const result = await pool.request().input('email', sql.NVarChar(254), email).input('phone', sql.VarChar(16), phone)
      .query(`SELECT TOP (1) user_id,full_name,email,phone_e164,password_hash
        FROM dbo.Users WHERE account_status='active'
          AND ((@email IS NOT NULL AND email=@email) OR (@phone IS NOT NULL AND phone_e164=@phone))`);
    const user = result.recordset[0];
    if (!user?.password_hash || !(await bcrypt.compare(parsed.data.password, user.password_hash))) {
      return res.status(401).json({ error: { code: 'INVALID_CREDENTIALS', message: 'Email/phone or password is incorrect.' } });
    }
    const session = await issueSession(pool, user.user_id, res);
    return res.json({ data: { user: publicUser(user), ...session } });
  } catch (error) { next(error); }
});

authRouter.get('/me', requireUser, (req, res) => res.json({ data: { user: publicUser(req.user) } }));
authRouter.post('/signout', requireUser, async (req, res, next) => {
  try {
    const pool = await getPool();
    await pool.request().input('sessionId', sql.UniqueIdentifier, req.sessionId)
      .query('UPDATE dbo.AuthSessions SET revoked_at=SYSUTCDATETIME() WHERE session_id=@sessionId AND revoked_at IS NULL');
    clearSessionCookie(res);
    res.json({ data: { signedOut: true } });
  } catch (error) { next(error); }
});

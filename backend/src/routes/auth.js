import { Router } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import { config } from '../config.js';
import sql from 'mssql/msnodesqlv8.js';
import bcrypt from 'bcryptjs';
import { getPool } from '../database.js';

export const authRouter = Router();
const credentialsSchema = z.object({ identifier: z.string().trim().min(3).max(254), password: z.string().min(8).max(128) });
const signupSchema = z.object({ fullName: z.string().trim().min(2).max(120), email: z.string().trim().email().max(254).optional().or(z.literal('')), phone: z.string().trim().regex(/^[6-9]\d{9}$/).optional().or(z.literal('')), password: z.string().min(8).max(128), confirmPassword: z.string().min(8).max(128) }).refine(value => value.email || value.phone, { message: 'Email or phone is required.' }).refine(value => value.password === value.confirmPassword, { message: 'Passwords do not match.', path: ['confirmPassword'] });
const requestSchema = z.object({ channel: z.enum(['sms', 'email']), destination: z.string().trim().min(5).max(254) });
const verifySchema = requestSchema.extend({ code: z.string().regex(/^\d{6}$/) });
const emailChallenges = new Map();

function hashToken(token) { return crypto.createHash('sha256').update(token).digest(); }
function publicUser(row) { return { id: row.user_id, fullName: row.full_name, email: row.email, phone: row.phone_e164 }; }
function sessionCookie(res, token) { res.setHeader('Set-Cookie', `clivelle_session=${token}; Max-Age=${30 * 24 * 60 * 60}; Path=/; HttpOnly; SameSite=Lax${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`); }

authRouter.post('/signup', async (req, res, next) => {
  const parsed = signupSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: { code: 'INVALID_SIGNUP', message: 'Check your name, email or phone, and password.' } });
  const email = parsed.data.email ? parsed.data.email.toLowerCase() : null;
  const phone = parsed.data.phone ? `+91${parsed.data.phone}` : null;
  try {
    const pool = await getPool();
    const existing = await pool.request().input('email', sql.NVarChar(254), email).input('phone', sql.VarChar(16), phone).query('SELECT TOP (1) user_id FROM dbo.Users WHERE (@email IS NOT NULL AND email = @email) OR (@phone IS NOT NULL AND phone_e164 = @phone);');
    if (existing.recordset.length) return res.status(409).json({ error: { code: 'ACCOUNT_EXISTS', message: 'An account already exists with these details. Please sign in instead.' } });
    const passwordHash = await bcrypt.hash(parsed.data.password, 12);
    const result = await pool.request().input('fullName', sql.NVarChar(120), parsed.data.fullName).input('email', sql.NVarChar(254), email).input('phone', sql.VarChar(16), phone).input('passwordHash', sql.NVarChar(255), passwordHash).query('INSERT INTO dbo.Users(full_name,email,phone_e164,password_hash) OUTPUT INSERTED.user_id, INSERTED.full_name, INSERTED.email, INSERTED.phone_e164 VALUES(@fullName,@email,@phone,@passwordHash);');
    const token = crypto.randomBytes(32).toString('base64url');
    await pool.request().input('userId', sql.UniqueIdentifier, result.recordset[0].user_id).input('tokenHash', sql.VarBinary(64), hashToken(token)).input('expiresAt', sql.DateTime2, new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)).query('INSERT INTO dbo.AuthSessions(user_id,refresh_token_hash,expires_at) VALUES(@userId,@tokenHash,@expiresAt);');
    sessionCookie(res, token);
    return res.status(201).json({ data: { user: publicUser(result.recordset[0]) } });
  } catch (error) { return next(error); }
});

authRouter.post('/signin', async (req, res, next) => {
  const parsed = credentialsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: { code: 'INVALID_SIGNIN', message: 'Enter your email or phone and password.' } });
  const identifier = parsed.data.identifier.includes('@') ? parsed.data.identifier.toLowerCase() : `+91${parsed.data.identifier.replace(/\D/g, '')}`;
  try {
    const pool = await getPool();
    const result = await pool.request().input('identifier', sql.NVarChar(254), identifier).query('SELECT TOP (1) user_id, full_name, email, phone_e164, password_hash FROM dbo.Users WHERE account_status = \'active\' AND (email = @identifier OR phone_e164 = @identifier);');
    const row = result.recordset[0];
    if (!row?.password_hash || !(await bcrypt.compare(parsed.data.password, row.password_hash))) return res.status(401).json({ error: { code: 'INVALID_CREDENTIALS', message: 'Email/phone or password is incorrect.' } });
    const token = crypto.randomBytes(32).toString('base64url');
    await pool.request().input('userId', sql.UniqueIdentifier, row.user_id).input('tokenHash', sql.VarBinary(64), hashToken(token)).input('expiresAt', sql.DateTime2, new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)).query('INSERT INTO dbo.AuthSessions(user_id,refresh_token_hash,expires_at) VALUES(@userId,@tokenHash,@expiresAt);');
    sessionCookie(res, token);
    return res.json({ data: { user: publicUser(row) } });
  } catch (error) { return next(error); }
});

authRouter.post('/signout', async (_req, res, next) => { try { res.setHeader('Set-Cookie', 'clivelle_session=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax'); return res.json({ data: { signedOut: true } }); } catch (error) { return next(error); } });

function normalizeDestination(channel, destination) {
  return channel === 'email' ? destination.toLowerCase() : destination.replace(/[\s()-]/g, '');
}

function providerUnavailable(channel) {
  const error = new Error(`${channel} OTP provider is not configured.`);
  error.apiCode = 'OTP_PROVIDER_NOT_CONFIGURED';
  error.statusCode = 503;
  return error;
}

async function twilioRequest(to) {
  const credentials = Buffer.from(`${process.env.OTP_TWILIO_ACCOUNT_SID}:${process.env.OTP_TWILIO_AUTH_TOKEN}`).toString('base64');
  const body = new URLSearchParams({ To: to, Channel: 'sms' });
  const response = await fetch(`https://verify.twilio.com/v2/Services/${process.env.OTP_TWILIO_VERIFY_SERVICE_SID}/Verifications`, {
    method: 'POST', headers: { Authorization: `Basic ${credentials}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body
  });
  if (!response.ok) { const error = new Error('SMS OTP provider rejected the request.'); error.apiCode = 'OTP_PROVIDER_ERROR'; error.statusCode = 502; throw error; }
}

async function twilioVerify(to, code) {
  const credentials = Buffer.from(`${process.env.OTP_TWILIO_ACCOUNT_SID}:${process.env.OTP_TWILIO_AUTH_TOKEN}`).toString('base64');
  const body = new URLSearchParams({ To: to, Code: code });
  const response = await fetch(`https://verify.twilio.com/v2/Services/${process.env.OTP_TWILIO_VERIFY_SERVICE_SID}/VerificationCheck`, {
    method: 'POST', headers: { Authorization: `Basic ${credentials}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body
  });
  if (!response.ok) { const error = new Error('SMS OTP provider rejected the verification.'); error.apiCode = 'OTP_PROVIDER_ERROR'; error.statusCode = 502; throw error; }
  return (await response.json()).status === 'approved';
}

async function sendEmail(to, code) {
  const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST', headers: { Authorization: `Bearer ${process.env.OTP_SENDGRID_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ personalizations: [{ to: [{ email: to }] }], from: { email: process.env.OTP_EMAIL_FROM }, subject: 'Your Clivelle verification code', content: [{ type: 'text/plain', value: `Your Clivelle verification code is ${code}. It expires in 10 minutes.` }] })
  });
  if (!response.ok) { const error = new Error('Email OTP provider rejected the request.'); error.apiCode = 'OTP_PROVIDER_ERROR'; error.statusCode = 502; throw error; }
}

authRouter.post('/otp/request', async (req, res, next) => {
  const parsed = requestSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: { code: 'INVALID_OTP_REQUEST', message: 'Provide a valid OTP channel and destination.' } });
  const { channel } = parsed.data;
  const destination = normalizeDestination(channel, parsed.data.destination);
  try {
    if (channel === 'sms') {
      if (!config.otp.smsConfigured) throw providerUnavailable(channel);
      await twilioRequest(destination);
    } else {
      if (!config.otp.emailConfigured) throw providerUnavailable(channel);
      const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
      emailChallenges.set(destination, { hash: crypto.createHash('sha256').update(code).digest('hex'), expiresAt: Date.now() + 10 * 60 * 1000, attempts: 0 });
      await sendEmail(destination, code);
    }
    return res.status(202).json({ data: { channel, destination, status: 'sent' } });
  } catch (error) { return next(error); }
});

authRouter.post('/otp/verify', async (req, res, next) => {
  const parsed = verifySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: { code: 'INVALID_OTP_REQUEST', message: 'Provide a valid OTP channel, destination and six-digit code.' } });
  const { channel, code } = parsed.data;
  const destination = normalizeDestination(channel, parsed.data.destination);
  try {
    const approved = channel === 'sms'
      ? (config.otp.smsConfigured ? await twilioVerify(destination, code) : (() => { throw providerUnavailable(channel); })())
      : (() => { const challenge = emailChallenges.get(destination); if (!config.otp.emailConfigured) throw providerUnavailable(channel); if (!challenge || challenge.expiresAt < Date.now() || challenge.attempts >= 5) return false; challenge.attempts += 1; const hash = crypto.createHash('sha256').update(code).digest('hex'); if (!crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(challenge.hash))) return false; emailChallenges.delete(destination); return true; })();
    return res.json({ data: { channel, destination, verified: approved } });
  } catch (error) { return next(error); }
});

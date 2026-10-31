import { Router } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import { config } from '../config.js';

export const authRouter = Router();
const requestSchema = z.object({ channel: z.enum(['sms', 'email']), destination: z.string().trim().min(5).max(254) });
const verifySchema = requestSchema.extend({ code: z.string().regex(/^\d{6}$/) });
const emailChallenges = new Map();

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

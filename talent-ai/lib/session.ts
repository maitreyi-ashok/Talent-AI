import { createHmac, timingSafeEqual } from 'crypto';

/* Signed, HttpOnly session cookie issued after the team passcode is entered. No user table — one shared passcode. */

export const COOKIE = 'ta_session';
const TTL_SECONDS = 12 * 3600;

const secret = () => process.env.SESSION_SECRET || process.env.APP_PASSCODE || '';
const sign = (payload: string) => createHmac('sha256', secret()).update(payload).digest('base64url');

/** In local development without a passcode the app is open; in production it never is. */
export const authDisabled = () => process.env.NODE_ENV === 'development' && !process.env.APP_PASSCODE;

export function makeToken(nowMs = Date.now()): string {
  const exp = Math.floor(nowMs / 1000) + TTL_SECONDS;
  return `${exp}.${sign(String(exp))}`;
}

export function verifyToken(token: string | undefined, nowMs = Date.now()): boolean {
  if (!token || !secret()) return false;
  const [exp, sig] = token.split('.');
  if (!exp || !sig || !/^\d+$/.test(exp) || Number(exp) * 1000 < nowMs) return false;
  const expected = Buffer.from(sign(exp));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.get('cookie') || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return undefined;
}

export const hasSession = (req: Request) => authDisabled() || verifyToken(readCookie(req, COOKIE));

const secure = () => (process.env.NODE_ENV === 'production' ? '; Secure' : '');
export const sessionCookie = (token: string) => `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${TTL_SECONDS}${secure()}`;
export const clearedCookie = () => `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure()}`;

import { aiEnabled, json, rateLimited } from './ai-server';
import { dbEnabled } from './db';
import { authDisabled, hasSession } from './session';

const host = (req: Request) => req.headers.get('x-forwarded-host') || req.headers.get('host') || '';

/** Browsers send Origin on cross-site POSTs; reject any that isn't this site (CSRF defence on top of SameSite cookies). */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get('origin');
  if (!origin) return true;
  try {
    return new URL(origin).host === host(req);
  } catch {
    return false;
  }
}

/** Recruiter-only endpoints: must be signed in. */
export function requireSession(req: Request, opts: { needDb?: boolean } = {}): Response | null {
  if (!process.env.APP_PASSCODE && !authDisabled()) {
    return json({ error: 'Set the APP_PASSCODE environment variable to protect this app.', code: 'no_passcode' }, 503);
  }
  if (rateLimited(req, 400, 10 * 60 * 1000, 'session')) return json({ error: 'Too many requests. Try again in a few minutes.' }, 429);
  if (!hasSession(req)) return json({ error: 'Please sign in.', code: 'auth' }, 401);
  if (req.method !== 'GET' && !sameOrigin(req)) return json({ error: 'Cross-site request blocked.' }, 403);
  if (opts.needDb && !dbEnabled()) return json({ error: 'No database is connected. Add Neon Postgres to this Vercel project.', code: 'no_db' }, 503);
  return null;
}

/** AI endpoints: signed in, and an API key exists. */
export function guard(req: Request): Response | null {
  const blocked = requireSession(req);
  if (blocked) return blocked;
  if (!aiEnabled()) return json({ error: 'AI is not enabled on this deployment.' }, 503);
  if (rateLimited(req, 60, 10 * 60 * 1000, 'ai')) return json({ error: 'Too many AI requests. Try again in a few minutes.' }, 429);
  return null;
}

/** Candidate-facing endpoints: no login, but unguessable ids, per-IP limits, and a database. */
export function publicGuard(req: Request): Response | null {
  if (rateLimited(req, 240, 10 * 60 * 1000, 'public')) return json({ error: 'Too many requests. Please wait a few minutes.' }, 429);
  if (!dbEnabled()) return json({ error: 'This service is not available right now.' }, 503);
  if (req.method !== 'GET' && !sameOrigin(req)) return json({ error: 'Cross-site request blocked.' }, 403);
  return null;
}

/** 24 random bytes as hex (≈192 bits) — used for unguessable test and interview links. */
export function newId(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export const validId = (s: string) => /^[a-f0-9]{48}$/.test(s);

/** Links in outgoing email must point at this deployment, never elsewhere. */
export function sameHost(req: Request, link: string): boolean {
  try {
    return new URL(link).host === host(req);
  } catch {
    return false;
  }
}

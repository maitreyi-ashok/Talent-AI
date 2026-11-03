import { json, passcodeOk, rateLimited } from '@/lib/ai-server';
import { sameOrigin } from '@/lib/server-guard';
import { makeToken, sessionCookie } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  if (!process.env.APP_PASSCODE) return json({ error: 'APP_PASSCODE is not set on this deployment.', code: 'no_passcode' }, 503);
  if (!sameOrigin(req)) return json({ error: 'Cross-site request blocked.' }, 403);
  if (rateLimited(req, 10, 10 * 60 * 1000, 'login')) return json({ error: 'Too many attempts. Try again in 10 minutes.' }, 429);

  let passcode = '';
  try {
    const b = (await req.json()) as { passcode?: unknown };
    passcode = typeof b.passcode === 'string' ? b.passcode : '';
  } catch {
    /* fall through */
  }
  if (!passcodeOk(passcode)) return json({ error: 'That passcode was not accepted.' }, 401);

  const res = json({ ok: true });
  res.headers.append('set-cookie', sessionCookie(makeToken()));
  return res;
}

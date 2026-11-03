import { aiEnabled, json, MODEL } from '@/lib/ai-server';
import { dbEnabled } from '@/lib/db';
import { authDisabled, hasSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

/** What this deployment can do, and whether the caller is signed in. Never returns secrets. */
export async function GET(req: Request) {
  return json({
    authenticated: hasSession(req),
    openAccess: authDisabled(),
    passcodeSet: Boolean(process.env.APP_PASSCODE),
    dbReady: dbEnabled(),
    aiAvailable: aiEnabled(),
    mailReady: Boolean(process.env.RESEND_API_KEY && process.env.MAIL_FROM),
    videoProvider: process.env.DAILY_API_KEY ? 'daily' : 'jitsi',
    model: MODEL,
  });
}

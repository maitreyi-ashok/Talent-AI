import { json } from '@/lib/ai-server';
import { requireSession, sameHost } from '@/lib/server-guard';
import { interviewInvite, testInvite, toHtml } from '@/lib/templates';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const EMAIL_RE = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]{2,}$/;
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/**
 * Sends one of two fixed templates (test invitation, interview invitation) to one candidate.
 * It can't send arbitrary text, and links must point at this deployment, so it can't be used as a mail relay.
 */
export async function POST(req: Request) {
  const blocked = requireSession(req);
  if (blocked) return blocked;

  const key = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM;
  if (!key || !from) return json({ error: 'Email is not configured on this deployment.', code: 'mail_not_configured' }, 503);

  let b: { type?: unknown; to?: unknown; params?: unknown };
  try {
    b = (await req.json()) as typeof b;
  } catch {
    return json({ error: 'Invalid request.' }, 400);
  }
  const to = str(b.to, 200);
  const p = (typeof b.params === 'object' && b.params !== null ? b.params : {}) as Record<string, unknown>;
  const link = str(p.link, 500);
  if (!EMAIL_RE.test(to)) return json({ error: 'That email address does not look valid.' }, 400);
  if (!link || !sameHost(req, link)) return json({ error: 'The link must point at this site.' }, 400);

  const params = {
    candidateName: str(p.candidateName, 80),
    jobTitle: str(p.jobTitle, 120) || 'the role',
    company: str(p.company, 80),
    link,
    timeLimitMin: typeof p.timeLimitMin === 'number' ? Math.round(p.timeLimitMin) : undefined,
    startsAt: typeof p.startsAt === 'number' ? p.startsAt : undefined,
    durationMin: typeof p.durationMin === 'number' ? Math.round(p.durationMin) : undefined,
    timeZoneLabel: /^[A-Za-z_]+(\/[A-Za-z_+\-0-9]+){0,2}$/.test(str(p.timeZoneLabel, 60)) ? str(p.timeZoneLabel, 60) : 'UTC',
  };
  const mail = b.type === 'interview_invite' ? interviewInvite(params) : b.type === 'test_invite' ? testInvite(params) : null;
  if (!mail) return json({ error: 'Unknown email type.' }, 400);

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from,
        to: [to],
        subject: mail.subject,
        text: mail.text,
        html: toHtml(mail.text),
        ...(process.env.MAIL_REPLY_TO ? { reply_to: process.env.MAIL_REPLY_TO } : {}),
      }),
    });
    const j = (await res.json().catch(() => ({}))) as { message?: string };
    if (!res.ok) return json({ error: `Email provider refused the message${j.message ? `: ${j.message}` : ` (${res.status})`}` }, 502);
    return json({ ok: true });
  } catch {
    return json({ error: 'Could not reach the email provider.' }, 502);
  }
}

import { json } from '@/lib/ai-server';
import { putDoc } from '@/lib/db';
import { DAY } from '@/lib/records';
import type { InterviewRecord } from '@/lib/records';
import { newId, requireSession } from '@/lib/server-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const JOIN_EARLY_MS = 15 * 60_000;
const JOIN_LATE_MS = 30 * 60_000;

/** Recruiter: create a video room for one interview. Uses Daily if DAILY_API_KEY is set, otherwise a Jitsi link. */
export async function POST(req: Request) {
  const blocked = requireSession(req, { needDb: true });
  if (blocked) return blocked;

  let b: Record<string, unknown>;
  try {
    b = (await req.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'Invalid request.' }, 400);
  }
  const jobTitle = text(b.jobTitle, 120);
  const startsAt = typeof b.startsAt === 'number' ? b.startsAt : NaN;
  const durationMin = typeof b.durationMin === 'number' ? Math.round(b.durationMin) : 30;
  const now = Date.now();
  if (!jobTitle) return json({ error: 'The interview needs a job title.' }, 400);
  if (!Number.isFinite(startsAt) || startsAt < now - 3600_000 || startsAt > now + 120 * DAY) return json({ error: 'Choose a start time within the next 120 days.' }, 400);
  if (durationMin < 10 || durationMin > 180) return json({ error: 'Duration must be 10–180 minutes.' }, 400);

  const id = newId();
  const roomName = `ti-${id.slice(0, 20)}`;
  const endsAt = startsAt + durationMin * 60_000;
  let roomUrl = '';
  let provider: InterviewRecord['provider'] = 'jitsi';

  try {
    if (process.env.DAILY_API_KEY) {
      const res = await fetch('https://api.daily.co/v1/rooms', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.DAILY_API_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          name: roomName,
          privacy: 'public',
          properties: {
            nbf: Math.floor((startsAt - JOIN_EARLY_MS) / 1000),
            exp: Math.floor((endsAt + JOIN_LATE_MS) / 1000),
            max_participants: 8,
            enable_prejoin_ui: true,
          },
        }),
      });
      const j = (await res.json().catch(() => ({}))) as { url?: string; error?: string; info?: string };
      if (!res.ok || !j.url) return json({ error: `Video provider error${j.info || j.error ? `: ${j.info || j.error}` : ` (${res.status})`}` }, 502);
      roomUrl = j.url;
      provider = 'daily';
    } else {
      const domain = (process.env.JITSI_DOMAIN || 'meet.jit.si').replace(/[^a-z0-9.\-:]/gi, '');
      roomUrl = `https://${domain}/TalentAI-${id.slice(0, 20)}`;
    }
    const rec: InterviewRecord = { id, jobTitle, candidateName: text(b.candidateName, 80), startsAt, durationMin, roomUrl, provider, status: 'scheduled' };
    await putDoc('interview', id, rec);
    return json({ id, provider });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Could not create the interview.' }, 502);
  }
}

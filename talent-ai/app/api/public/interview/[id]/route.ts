import { json } from '@/lib/ai-server';
import { getDoc } from '@/lib/db';
import { firstName } from '@/lib/records';
import type { InterviewRecord } from '@/lib/records';
import { publicGuard, validId } from '@/lib/server-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const EARLY = 15 * 60_000;
const LATE = 30 * 60_000;

/** Candidate: interview details. The room link is only revealed from 15 minutes before the start. */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const blocked = publicGuard(req);
  if (blocked) return blocked;
  if (!validId(params.id)) return json({ error: 'This link is not valid.' }, 404);
  const rec = await getDoc<InterviewRecord>('interview', params.id).catch(() => null);
  if (!rec) return json({ error: 'This link is not valid or has expired.' }, 404);

  const now = Date.now();
  const opensAt = rec.startsAt - EARLY;
  const closesAt = rec.startsAt + rec.durationMin * 60_000 + LATE;
  const open = rec.status === 'scheduled' && now >= opensAt && now <= closesAt;
  return json({
    status: rec.status === 'cancelled' ? 'cancelled' : now > closesAt ? 'ended' : open ? 'open' : 'waiting',
    jobTitle: rec.jobTitle,
    candidateName: firstName(rec.candidateName),
    startsAt: rec.startsAt,
    durationMin: rec.durationMin,
    opensAt,
    roomUrl: open ? rec.roomUrl : null,
  });
}

import { json } from '@/lib/ai-server';
import { getDoc, putDoc } from '@/lib/db';
import type { InterviewRecord } from '@/lib/records';
import { requireSession, validId } from '@/lib/server-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Recruiter: cancel an interview. The candidate's page then shows it as cancelled. */
export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const blocked = requireSession(req, { needDb: true });
  if (blocked) return blocked;
  if (!validId(params.id)) return json({ error: 'Not found.' }, 404);
  const rec = await getDoc<InterviewRecord>('interview', params.id).catch(() => null);
  if (!rec) return json({ error: 'Not found.' }, 404);
  await putDoc('interview', rec.id, { ...rec, status: 'cancelled' });
  return json({ ok: true });
}

/** Recruiter: the room link, for opening the interview. */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const blocked = requireSession(req, { needDb: true });
  if (blocked) return blocked;
  if (!validId(params.id)) return json({ error: 'Not found.' }, 404);
  const rec = await getDoc<InterviewRecord>('interview', params.id).catch(() => null);
  if (!rec) return json({ error: 'Not found.' }, 404);
  return json({ roomUrl: rec.roomUrl, status: rec.status, startsAt: rec.startsAt, durationMin: rec.durationMin });
}

import { json } from '@/lib/ai-server';
import { getDoc, putDoc } from '@/lib/db';
import type { TestRecord } from '@/lib/records';
import { publicGuard, validId } from '@/lib/server-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Candidate: start the clock (idempotent — refreshing the page does not reset the timer). */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const blocked = publicGuard(req);
  if (blocked) return blocked;
  if (!validId(params.id)) return json({ error: 'This link is not valid.' }, 404);

  const rec = await getDoc<TestRecord>('test', params.id).catch(() => null);
  if (!rec) return json({ error: 'This link is not valid or has expired.' }, 404);
  const now = Date.now();
  if (rec.submittedAt) return json({ error: 'This test has already been submitted.' }, 409);
  if (now > rec.expiresAt) return json({ error: 'This test link has expired.' }, 410);

  if (!rec.startedAt) {
    rec.startedAt = now;
    await putDoc('test', rec.id, rec);
  }
  return json({ remainingSeconds: Math.max(0, Math.round((rec.startedAt + rec.timeLimitMin * 60_000 - now) / 1000)) });
}

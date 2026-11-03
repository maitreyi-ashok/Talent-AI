import { json } from '@/lib/ai-server';
import { publicQuestions } from '@/lib/grading';
import { getDoc } from '@/lib/db';
import { firstName } from '@/lib/records';
import type { TestRecord } from '@/lib/records';
import { publicGuard, validId } from '@/lib/server-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Candidate: open a test link. Never includes the answer key. */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const blocked = publicGuard(req);
  if (blocked) return blocked;
  if (!validId(params.id)) return json({ error: 'This link is not valid.' }, 404);

  const rec = await getDoc<TestRecord>('test', params.id).catch(() => null);
  if (!rec) return json({ error: 'This link is not valid or has expired.' }, 404);

  const now = Date.now();
  if (rec.submittedAt) return json({ status: 'submitted', jobTitle: rec.jobTitle });
  if (now > rec.expiresAt) return json({ status: 'expired', jobTitle: rec.jobTitle });

  const remainingSeconds = rec.startedAt ? Math.max(0, Math.round((rec.startedAt + rec.timeLimitMin * 60_000 - now) / 1000)) : null;
  return json({
    status: rec.startedAt ? 'started' : 'open',
    jobTitle: rec.jobTitle,
    candidateName: firstName(rec.candidateName),
    title: rec.title,
    instructions: rec.instructions,
    timeLimitMin: rec.timeLimitMin,
    remainingSeconds,
    questions: publicQuestions(rec.questions),
  });
}

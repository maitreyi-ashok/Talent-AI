import { json } from '@/lib/ai-server';
import { getDoc } from '@/lib/db';
import type { TestRecord } from '@/lib/records';
import { requireSession, validId } from '@/lib/server-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Recruiter: status of a test and, once submitted, the full result for review. */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const blocked = requireSession(req, { needDb: true });
  if (blocked) return blocked;
  if (!validId(params.id)) return json({ error: 'Not found.' }, 404);

  const rec = await getDoc<TestRecord>('test', params.id).catch(() => null);
  if (!rec) return json({ error: 'Not found (it may have expired).' }, 404);

  const status = rec.submittedAt ? 'submitted' : rec.startedAt ? 'started' : 'sent';
  if (!rec.submittedAt || !rec.graded) return json({ status, startedAt: rec.startedAt ?? null });

  const answers = new Map((rec.answers ?? []).map((a) => [a.questionId, a.value]));
  const review = rec.questions.map((q) => {
    const g = rec.graded!.perQuestion.find((p) => p.questionId === q.id);
    const given = answers.get(q.id);
    return {
      prompt: q.prompt,
      type: q.type,
      answer: q.type === 'mcq' ? (typeof given === 'number' ? q.options?.[given] ?? '' : '') : typeof given === 'string' ? given : '',
      correctAnswer: q.type === 'mcq' && q.correct !== undefined ? q.options?.[q.correct] ?? '' : undefined,
      rubric: q.type === 'short' ? q.rubric : undefined,
      earned: g?.earned ?? 0,
      max: g?.max ?? q.points,
      note: g?.note,
    };
  });
  return json({
    status,
    submittedAt: rec.submittedAt,
    scorePct: rec.graded.scorePct,
    passed: rec.graded.passed,
    needsReview: rec.graded.needsReview,
    late: Boolean(rec.late),
    passMarkPct: rec.passMarkPct,
    review,
  });
}

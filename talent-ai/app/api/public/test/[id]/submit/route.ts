import { aiEnabled, callClaude, coerceShortGrades, extractJSON, GRADE_SYSTEM, json } from '@/lib/ai-server';
import { gradeTest } from '@/lib/grading';
import type { Answer, ShortGrade } from '@/lib/grading';
import { getDoc, putDoc } from '@/lib/db';
import type { TestRecord } from '@/lib/records';
import { publicGuard, validId } from '@/lib/server-guard';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const GRACE_MS = 2 * 60_000;

/** Candidate: submit answers. Multiple choice is graded here; free text is graded by AI if enabled and always flagged for a human. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const blocked = publicGuard(req);
  if (blocked) return blocked;
  if (!validId(params.id)) return json({ error: 'This link is not valid.' }, 404);

  const rec = await getDoc<TestRecord>('test', params.id).catch(() => null);
  if (!rec) return json({ error: 'This link is not valid or has expired.' }, 404);
  if (rec.submittedAt) return json({ ok: true, already: true });
  const now = Date.now();
  if (now > rec.expiresAt) return json({ error: 'This test link has expired.' }, 410);

  let body: { answers?: unknown };
  try {
    body = (await req.json()) as { answers?: unknown };
  } catch {
    return json({ error: 'Invalid request.' }, 400);
  }
  const ids = new Set(rec.questions.map((q) => q.id));
  const answers: Answer[] = (Array.isArray(body.answers) ? body.answers : [])
    .slice(0, 60)
    .map((a) => a as { questionId?: unknown; value?: unknown })
    .filter((a) => typeof a.questionId === 'string' && ids.has(a.questionId))
    .map((a) => ({
      questionId: a.questionId as string,
      value: typeof a.value === 'number' && Number.isInteger(a.value) ? a.value : typeof a.value === 'string' ? a.value.slice(0, 4000) : '',
    }));

  const startedAt = rec.startedAt ?? now;
  const late = now > startedAt + rec.timeLimitMin * 60_000 + GRACE_MS;

  let shortGrades: Record<string, ShortGrade> | undefined;
  const shorts = rec.questions.filter((q) => q.type === 'short');
  if (shorts.length && aiEnabled()) {
    try {
      const payload = shorts.map((q) => ({ id: q.id, question: q.prompt, rubric: q.rubric ?? '', maxPoints: q.points, answer: String(answers.find((a) => a.questionId === q.id)?.value ?? '') }));
      const reply = await callClaude(GRADE_SYSTEM, [{ type: 'text', text: `Grade these answers:\n${JSON.stringify(payload)}` }], 1200);
      shortGrades = coerceShortGrades(extractJSON(reply), rec.questions);
    } catch {
      shortGrades = undefined; // leave ungraded; a human will mark it
    }
  }

  const graded = gradeTest({ questions: rec.questions, answers, shortGrades, passMarkPct: rec.passMarkPct, late });
  rec.startedAt = startedAt;
  rec.submittedAt = now;
  rec.answers = answers;
  rec.graded = graded;
  rec.shortGrades = shortGrades;
  rec.late = late;
  await putDoc('test', rec.id, rec);
  return json({ ok: true });
}

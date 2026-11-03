import { json } from '@/lib/ai-server';
import { sanitizeQuestions } from '@/lib/grading';
import { purgeOld, putDoc } from '@/lib/db';
import { DAY, TEST_VALID_DAYS } from '@/lib/records';
import type { TestRecord } from '@/lib/records';
import { newId, requireSession } from '@/lib/server-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Recruiter: publish a test for one candidate. Returns the id used in the candidate's link. */
export async function POST(req: Request) {
  const blocked = requireSession(req, { needDb: true });
  if (blocked) return blocked;

  let b: Record<string, unknown>;
  try {
    b = (await req.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'Invalid request.' }, 400);
  }
  const questions = sanitizeQuestions(b.questions);
  const jobTitle = text(b.jobTitle, 120);
  if (!questions || !jobTitle) return json({ error: 'The test needs a job title and at least one valid question.' }, 400);

  const timeLimitMin = typeof b.timeLimitMin === 'number' ? Math.round(b.timeLimitMin) : 30;
  const passMarkPct = typeof b.passMarkPct === 'number' ? Math.round(b.passMarkPct) : 70;
  if (timeLimitMin < 5 || timeLimitMin > 180 || passMarkPct < 1 || passMarkPct > 100) return json({ error: 'Time limit must be 5–180 minutes and pass mark 1–100%.' }, 400);

  const id = newId();
  const now = Date.now();
  const rec: TestRecord = {
    id,
    jobTitle,
    candidateName: text(b.candidateName, 80),
    title: text(b.title, 120) || `Assessment — ${jobTitle}`,
    instructions: text(b.instructions, 1500),
    timeLimitMin,
    passMarkPct,
    questions,
    createdAt: now,
    expiresAt: now + TEST_VALID_DAYS * DAY,
  };
  try {
    await putDoc('test', id, rec);
    await purgeOld(['test', 'interview'], 60 * DAY);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Could not save the test.' }, 502);
  }
  return json({ id });
}

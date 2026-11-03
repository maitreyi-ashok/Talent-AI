import { callClaude, coerceGeneratedTest, extractJSON, GEN_TEST_SYSTEM, json } from '@/lib/ai-server';
import { guard } from '@/lib/server-guard';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 30) : []);
const clampInt = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : d);

/** Recruiter: draft a skills test for a job. The recruiter reviews and edits it before anything is sent. */
export async function POST(req: Request) {
  const blocked = guard(req);
  if (blocked) return blocked;
  let b: { job?: Record<string, unknown>; mcq?: unknown; short?: unknown };
  try {
    b = (await req.json()) as typeof b;
  } catch {
    return json({ error: 'Invalid request.' }, 400);
  }
  const job = b.job ?? {};
  const title = typeof job.title === 'string' ? job.title.slice(0, 120) : '';
  if (!title) return json({ error: 'The job needs a title.' }, 400);
  const mcq = clampInt(b.mcq, 0, 15, 8);
  const short = clampInt(b.short, 0, 4, 2);
  if (mcq + short === 0) return json({ error: 'Ask for at least one question.' }, 400);

  const prompt = [
    `Job title: ${title}`,
    `Must-have skills: ${list(job.mustHave).join('; ') || '(none listed)'}`,
    `Nice-to-have skills: ${list(job.niceToHave).join('; ') || '(none)'}`,
    typeof job.description === 'string' && job.description ? `Description:\n${job.description.slice(0, 3000)}` : '',
    `Write exactly ${mcq} multiple-choice and ${short} short-answer questions.`,
  ].filter(Boolean).join('\n');

  try {
    const reply = await callClaude(GEN_TEST_SYSTEM, [{ type: 'text', text: prompt }], 3000);
    const questions = coerceGeneratedTest(extractJSON(reply));
    if (!questions.length) return json({ error: 'The AI did not return usable questions. Try again.' }, 502);
    return json({ questions });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Could not generate a test.' }, 502);
  }
}

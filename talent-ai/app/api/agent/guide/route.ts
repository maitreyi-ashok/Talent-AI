import { callClaude, coerceGuide, extractJSON, GUIDE_SYSTEM, json } from '@/lib/ai-server';
import { guard } from '@/lib/server-guard';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const list = (v: unknown, n = 10) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, n).map((s) => s.slice(0, 300)) : []);

/** Recruiter: interview preparation notes. Receives job + gaps + missed test topics only — never the candidate's name or contact details. */
export async function POST(req: Request) {
  const blocked = guard(req);
  if (blocked) return blocked;
  let b: { jobTitle?: unknown; mustHave?: unknown; gaps?: unknown; missed?: unknown; testScorePct?: unknown };
  try {
    b = (await req.json()) as typeof b;
  } catch {
    return json({ error: 'Invalid request.' }, 400);
  }
  const jobTitle = typeof b.jobTitle === 'string' ? b.jobTitle.slice(0, 120) : '';
  if (!jobTitle) return json({ error: 'The job needs a title.' }, 400);
  const prompt = [
    `Job: ${jobTitle}`,
    `Must-have skills: ${list(b.mustHave, 20).join('; ') || '(none)'}`,
    `Gaps found in the resume: ${list(b.gaps).join('; ') || '(none)'}`,
    `Test result: ${typeof b.testScorePct === 'number' ? `${Math.round(b.testScorePct)}%` : 'n/a'}`,
    `Test questions the candidate missed: ${list(b.missed).join(' | ') || '(none)'}`,
  ].join('\n');
  try {
    const reply = await callClaude(GUIDE_SYSTEM, [{ type: 'text', text: prompt }], 1500);
    return json(coerceGuide(extractJSON(reply)));
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Could not prepare the guide.' }, 502);
  }
}

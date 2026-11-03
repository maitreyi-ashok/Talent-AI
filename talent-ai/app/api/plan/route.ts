import { callClaude, coercePlan, extractJSON, json, PLAN_SYSTEM } from '@/lib/ai-server';
import { guard } from '@/lib/server-guard';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

type Body = { roleName?: unknown; gaps?: unknown };

export async function POST(req: Request) {
  const blocked = guard(req);
  if (blocked) return blocked;

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return json({ error: 'Invalid request.' }, 400);
  }
  const role = typeof body.roleName === 'string' ? body.roleName.slice(0, 100) : 'the role';
  const gaps = (Array.isArray(body.gaps) ? body.gaps : [])
    .slice(0, 12)
    .map((g) => g as { skill?: unknown; current?: unknown; target?: unknown })
    .filter((g) => typeof g.skill === 'string' && typeof g.current === 'number' && typeof g.target === 'number')
    .map((g) => `- ${String(g.skill).slice(0, 60)}: current ${g.current}/5, target ${g.target}/5`);
  if (!gaps.length) return json({ error: 'No skill gaps to plan for.' }, 400);

  try {
    // Only skills and levels are sent — never the employee's name.
    const reply = await callClaude(PLAN_SYSTEM, [{ type: 'text', text: `Role: ${role}\nGaps:\n${gaps.join('\n')}` }], 1200);
    return json(coercePlan(extractJSON(reply)));
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Could not create a plan.' }, 502);
  }
}

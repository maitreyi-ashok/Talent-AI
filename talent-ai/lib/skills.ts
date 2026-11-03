import type { Employee, RoleProfile } from './types';
import { skillKey } from './types';

export type Gap = { skill: string; current: number; target: number; gap: number };

export function employeeGaps(emp: Employee, role: RoleProfile | undefined): Gap[] {
  if (!role) return [];
  return role.requirements.map((r) => {
    const current = emp.skills[skillKey(r.skill)] ?? 0;
    return { skill: r.skill, current, target: r.target, gap: Math.max(0, r.target - current) };
  });
}

/** 0-100: how much of the role's target levels the employee already covers. */
export function readiness(gaps: Gap[]): number {
  const total = gaps.reduce((a, g) => a + g.target, 0);
  if (!total) return 0;
  const have = gaps.reduce((a, g) => a + Math.min(g.current, g.target), 0);
  return Math.round((have / total) * 100);
}

export type TeamSkillRow = {
  skill: string;
  avgCurrent: number;
  avgTarget: number;
  belowTarget: number;
  total: number;
  avgGap: number;
};

/** Aggregated view across all employees who have a role: where is the team short? */
export function teamSummary(employees: Employee[], roles: RoleProfile[]): TeamSkillRow[] {
  const acc = new Map<string, { skill: string; cur: number; tgt: number; below: number; n: number }>();
  for (const e of employees) {
    const role = roles.find((r) => r.id === e.roleId);
    for (const g of employeeGaps(e, role)) {
      const k = skillKey(g.skill);
      const row = acc.get(k) ?? { skill: g.skill, cur: 0, tgt: 0, below: 0, n: 0 };
      row.cur += g.current;
      row.tgt += g.target;
      row.below += g.gap > 0 ? 1 : 0;
      row.n += 1;
      acc.set(k, row);
    }
  }
  return [...acc.values()]
    .map((r) => ({
      skill: r.skill,
      avgCurrent: r.cur / r.n,
      avgTarget: r.tgt / r.n,
      belowTarget: r.below,
      total: r.n,
      avgGap: Math.max(0, (r.tgt - r.cur) / r.n),
    }))
    .sort((a, b) => b.avgGap - a.avgGap || b.belowTarget - a.belowTarget);
}

export type PlanStep = { skill: string; action: string; timeframe: string };
export type LearningPlan = { engine: 'ai' | 'template'; summary: string; steps: PlanStep[] };

/** Simple, deterministic plan used when AI is off. Biggest gaps first. */
export function templatePlan(gaps: Gap[]): LearningPlan {
  const open = gaps.filter((g) => g.gap > 0).sort((a, b) => b.gap - a.gap).slice(0, 4);
  return {
    engine: 'template',
    summary: open.length
      ? `Focus on ${open.map((g) => g.skill).join(', ')} — largest gaps first.`
      : 'No gaps against this role profile.',
    steps: open.map((g) => ({
      skill: g.skill,
      timeframe: g.gap >= 3 ? '8–12 weeks' : g.gap === 2 ? '4–8 weeks' : '2–4 weeks',
      action:
        g.gap >= 3
          ? `Structured course plus a small real project using ${g.skill}; pair with a colleague at level ${Math.min(5, g.target)}.`
          : `Practise ${g.skill} on live work with a mentor reviewing the output; move from level ${g.current} to ${g.target}.`,
    })),
  };
}

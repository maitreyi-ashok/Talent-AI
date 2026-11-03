import type { Employee, Signals } from './types';

/**
 * A transparent, rule-based set of retention signals — NOT a predictive model.
 * Use it to start supportive conversations early. Never use it for decisions on pay,
 * promotion, discipline or dismissal.
 */

export type Driver = { label: string; points: number; detail: string; action: string };
export type RiskLevel = 'low' | 'medium' | 'high' | 'unknown';
export type Risk = { score: number; level: RiskLevel; drivers: Driver[]; coverage: number };

const has = (v: number | null): v is number => v !== null && Number.isFinite(v);

export function assessRisk(s: Signals): Risk {
  const drivers: Driver[] = [];
  let provided = 0;
  const total = 6;

  if (has(s.engagement)) {
    provided++;
    if (s.engagement <= 2) drivers.push({ label: 'Low engagement', points: 30, detail: `Latest pulse score ${s.engagement}/5`, action: 'Hold a "stay conversation": ask what would make the role better and act on one thing.' });
    else if (s.engagement < 4) drivers.push({ label: 'Middling engagement', points: 12, detail: `Latest pulse score ${s.engagement}/5`, action: 'Ask what is working and what is getting in the way at the next 1:1.' });
  }
  if (has(s.monthsSincePromotion)) {
    provided++;
    if (s.monthsSincePromotion >= 36) drivers.push({ label: 'Long time without growth step', points: 20, detail: `${s.monthsSincePromotion} months since last promotion/role change`, action: 'Discuss a growth path or stretch assignment.' });
    else if (s.monthsSincePromotion >= 24) drivers.push({ label: 'Growth step overdue', points: 12, detail: `${s.monthsSincePromotion} months since last promotion/role change`, action: 'Discuss a growth path or stretch assignment.' });
    else if (s.monthsSincePromotion >= 18) drivers.push({ label: 'Approaching growth window', points: 6, detail: `${s.monthsSincePromotion} months since last promotion/role change`, action: 'Open a career conversation.' });
  }
  if (has(s.oneOnOnesPerMonth)) {
    provided++;
    if (s.oneOnOnesPerMonth < 1) drivers.push({ label: 'No regular 1:1s', points: 15, detail: 'No manager 1:1s per month', action: 'Start a regular fortnightly 1:1.' });
    else if (s.oneOnOnesPerMonth < 2) drivers.push({ label: 'Infrequent 1:1s', points: 8, detail: `${s.oneOnOnesPerMonth} manager 1:1 per month`, action: 'Move to a fortnightly 1:1 rhythm.' });
  }
  if (has(s.overtimeHoursPerWeek)) {
    provided++;
    if (s.overtimeHoursPerWeek >= 10) drivers.push({ label: 'Heavy overtime', points: 15, detail: `${s.overtimeHoursPerWeek} extra hours per week`, action: 'Review workload and redistribute or de-scope.' });
    else if (s.overtimeHoursPerWeek >= 5) drivers.push({ label: 'Regular overtime', points: 8, detail: `${s.overtimeHoursPerWeek} extra hours per week`, action: 'Check workload at the next 1:1.' });
  }
  if (has(s.compaRatio)) {
    provided++;
    if (s.compaRatio < 0.85) drivers.push({ label: 'Pay well below band', points: 15, detail: `Compa-ratio ${s.compaRatio.toFixed(2)}`, action: 'Review pay against the band through the normal compensation process.' });
    else if (s.compaRatio < 0.95) drivers.push({ label: 'Pay slightly below band', points: 8, detail: `Compa-ratio ${s.compaRatio.toFixed(2)}`, action: 'Flag for the next compensation review.' });
  }
  if (has(s.tenureMonths)) {
    provided++;
    if (s.tenureMonths < 12) drivers.push({ label: 'New joiner', points: 5, detail: `${s.tenureMonths} months in role`, action: 'Check onboarding progress at 30/60/90 days.' });
  }

  const coverage = provided / total;
  const score = Math.min(100, drivers.reduce((a, d) => a + d.points, 0));
  const level: RiskLevel = coverage < 0.5 ? 'unknown' : score >= 50 ? 'high' : score >= 25 ? 'medium' : 'low';
  return { score, level, drivers: drivers.sort((a, b) => b.points - a.points), coverage };
}

export function teamDrivers(employees: Employee[]): { label: string; count: number }[] {
  const m = new Map<string, number>();
  for (const e of employees) for (const d of assessRisk(e.signals).drivers) m.set(d.label, (m.get(d.label) ?? 0) + 1);
  return [...m.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
}

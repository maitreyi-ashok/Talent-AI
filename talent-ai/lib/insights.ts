import type { Candidate } from './types';

/**
 * "Learn from results": compares the AI/rules recommendation with what the humans actually decided.
 * Interview/Offer/Hired count as a positive human decision, Declined as a negative one.
 */
export type Calibration = {
  decided: number;
  agree: number;
  agreementPct: number | null;
  avgScoreAdvanced: number | null;
  avgScoreDeclined: number | null;
  humanOverrides: number; // recommended "hold" but advanced, or "advance" but declined
};

const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);

export function calibration(cands: Candidate[]): Calibration {
  // Only decisions a person made count — anything the agent moved on its own is not a judgement to learn from.
  const human = cands.filter((c) => c.stageBy !== 'agent');
  const positive = human.filter((c) => c.screening && ['interview', 'offer', 'hired'].includes(c.stage));
  const negative = human.filter((c) => c.screening && c.stage === 'declined');
  let agree = 0;
  let decided = 0;
  let overrides = 0;
  for (const c of [...positive, ...negative]) {
    const rec = c.screening!.recommendation;
    if (rec === 'review') continue; // "needs review" makes no call, so it can't agree or disagree
    decided++;
    const humanYes = positive.includes(c);
    if ((rec === 'advance') === humanYes) agree++;
    else overrides++;
  }
  return {
    decided,
    agree,
    agreementPct: decided ? Math.round((agree / decided) * 100) : null,
    avgScoreAdvanced: avg(positive.map((c) => c.screening!.score)),
    avgScoreDeclined: avg(negative.map((c) => c.screening!.score)),
    humanOverrides: overrides,
  };
}

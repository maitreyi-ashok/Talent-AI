import type { Question } from './types';

/* Pure grading helpers (server-side). Multiple-choice is graded automatically; free text is never auto-advanced. */

export type Answer = { questionId: string; value: string | number };
export type ShortGrade = { score: number; note: string };

export type Graded = {
  scorePct: number;
  passed: boolean;
  needsReview: boolean;
  mcqEarned: number;
  mcqMax: number;
  totalMax: number;
  perQuestion: { questionId: string; earned: number; max: number; note?: string }[];
};

export function gradeTest(args: {
  questions: Question[];
  answers: Answer[];
  shortGrades?: Record<string, ShortGrade>;
  passMarkPct: number;
  late?: boolean;
}): Graded {
  const byId = new Map(args.answers.map((a) => [a.questionId, a.value]));
  let mcqEarned = 0;
  let mcqMax = 0;
  let totalMax = 0;
  let earned = 0;
  let hasShort = false;
  const per: Graded['perQuestion'] = [];

  for (const q of args.questions) {
    const max = Math.max(0, q.points);
    totalMax += max;
    if (q.type === 'mcq') {
      mcqMax += max;
      const v = byId.get(q.id);
      const ok = typeof v === 'number' && v === q.correct;
      const e = ok ? max : 0;
      mcqEarned += e;
      earned += e;
      per.push({ questionId: q.id, earned: e, max });
    } else {
      hasShort = true;
      const g = args.shortGrades?.[q.id];
      const e = g ? Math.max(0, Math.min(max, g.score)) : 0;
      earned += e;
      per.push({ questionId: q.id, earned: e, max, note: g?.note });
    }
  }

  const scorePct = totalMax ? Math.round((earned / totalMax) * 100) : 0;
  return {
    scorePct,
    passed: scorePct >= args.passMarkPct,
    // free text (even AI-graded) and late submissions always get a human look
    needsReview: hasShort || Boolean(args.late),
    mcqEarned,
    mcqMax,
    totalMax,
    perQuestion: per,
  };
}

/** Remove everything a candidate must not see. */
export function publicQuestions(questions: Question[]) {
  return questions.map((q) => ({ id: q.id, type: q.type, prompt: q.prompt, options: q.options, points: q.points }));
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Validate a question list coming from the recruiter's browser. Returns null if unusable. */
export function sanitizeQuestions(raw: unknown): Question[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 40) return null;
  const out: Question[] = [];
  for (const r of raw) {
    if (!isObj(r)) return null;
    const type = r.type === 'short' ? 'short' : r.type === 'mcq' ? 'mcq' : null;
    const prompt = typeof r.prompt === 'string' ? r.prompt.trim().slice(0, 1500) : '';
    const id = typeof r.id === 'string' && r.id ? r.id.slice(0, 40) : '';
    const points = typeof r.points === 'number' && r.points > 0 && r.points <= 100 ? r.points : 1;
    if (!type || !prompt || !id) return null;
    if (type === 'mcq') {
      const options = Array.isArray(r.options) ? r.options.filter((o): o is string => typeof o === 'string' && o.trim() !== '').map((o) => o.trim().slice(0, 300)) : [];
      const correct = typeof r.correct === 'number' ? r.correct : -1;
      if (options.length < 2 || options.length > 6 || !Number.isInteger(correct) || correct < 0 || correct >= options.length) return null;
      out.push({ id, type, prompt, options, correct, points });
    } else {
      out.push({ id, type, prompt, rubric: typeof r.rubric === 'string' ? r.rubric.slice(0, 1000) : '', points });
    }
  }
  return out;
}

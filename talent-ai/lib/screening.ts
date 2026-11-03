import type { Job, Profile, Recommendation, ScreeningResult } from './types';

/**
 * Transparent, rule-based screening. Used when AI is off, and as a fallback if an AI call fails.
 * It only matches the skills you list on the job against the resume text — it never looks at
 * names, photos, schools, or anything else that isn't a job requirement.
 */

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9+#.\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function includesSkill(textNorm: string, skill: string): boolean {
  const s = norm(skill);
  if (!s) return false;
  return new RegExp(`(^|\\s)${escapeRe(s)}(\\s|$)`).test(textNorm);
}

function snippetFor(text: string, skill: string): string {
  const parts = text.split(/\n|(?<=[.!?])\s+/);
  for (const p of parts) {
    if (includesSkill(norm(p), skill)) return p.trim().replace(/\s+/g, ' ').slice(0, 180);
  }
  return '';
}

const COMMON_SKILLS = [
  'python', 'java', 'javascript', 'typescript', 'react', 'node.js', 'sql', 'excel', 'power bi', 'tableau',
  'aws', 'azure', 'docker', 'kubernetes', 'git', 'c#', 'c++', 'go', 'php', 'html', 'css', 'figma',
  'salesforce', 'sap', 'machine learning', 'data analysis', 'project management', 'agile', 'scrum',
  'communication', 'leadership', 'customer support', 'customer success', 'sales', 'negotiation',
  'recruiting', 'payroll', 'accounting', 'marketing', 'seo', 'content writing', 'testing', 'devops',
];

const DEGREE_RE = /\b(b\.?\s?tech|m\.?\s?tech|b\.?\s?e\b|bachelor|master|mba|ph\.?d|b\.?\s?sc|m\.?\s?sc|bca|mca|diploma)\b/i;

export function extractProfile(text: string, job?: Job): Profile {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const email = (text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i) || [''])[0];

  let name = '';
  for (const l of lines.slice(0, 5)) {
    const words = l.split(/\s+/);
    if (
      words.length >= 2 &&
      words.length <= 4 &&
      /^[A-Za-z][A-Za-z'’.\- ]+$/.test(l) &&
      !/resume|curriculum|vitae|\bcv\b|email|phone|profile|summary/i.test(l)
    ) {
      name = l;
      break;
    }
  }

  let years: number | null = null;
  for (const m of text.matchAll(/(\d{1,2})\s*\+?\s*(?:years|yrs)\b/gi)) {
    const n = Number(m[1]);
    if (n <= 45) years = Math.max(years ?? 0, n);
  }

  const t = norm(text);
  const vocab = new Set<string>(COMMON_SKILLS);
  job?.mustHave.forEach((s) => vocab.add(s));
  job?.niceToHave.forEach((s) => vocab.add(s));
  const skills = [...vocab].filter((s) => includesSkill(t, s)).slice(0, 24);

  const education = lines.filter((l) => DEGREE_RE.test(l)).map((l) => l.slice(0, 120)).slice(0, 3);
  const headline = lines.find((l, i) => i > 0 && i < 6 && l !== name && l.length < 90 && !/@|\d{5,}/.test(l)) || '';

  return { name, email, headline, yearsExperience: years, skills, education };
}

export function recommendationFor(score: number): Recommendation {
  return score >= 75 ? 'advance' : score >= 50 ? 'review' : 'hold';
}

export function screenWithRules(job: Job, resumeText: string): { profile: Profile; screening: ScreeningResult } {
  const profile = extractProfile(resumeText, job);
  const t = norm(resumeText);

  const must = job.mustHave.filter((s) => s.trim());
  const nice = job.niceToHave.filter((s) => s.trim());
  const mustHits = must.filter((s) => includesSkill(t, s));
  const niceHits = nice.filter((s) => includesSkill(t, s));

  const wMust = must.length ? 70 : 0;
  const wNice = nice.length ? 20 : 0;
  const wExp = 10;
  const mustRatio = must.length ? mustHits.length / must.length : 0;
  const niceRatio = nice.length ? niceHits.length / nice.length : 0;
  const expRatio = job.minYears <= 0 ? 1 : profile.yearsExperience === null ? 0 : Math.min(profile.yearsExperience / job.minYears, 1);
  const score = Math.round((100 * (wMust * mustRatio + wNice * niceRatio + wExp * expRatio)) / (wMust + wNice + wExp));

  const matched = [...mustHits, ...niceHits].map((requirement) => ({
    requirement,
    evidence: snippetFor(resumeText, requirement) || 'Mentioned in the resume.',
  }));
  const gaps = [
    ...must.filter((s) => !mustHits.includes(s)).map((requirement) => ({
      requirement,
      note: 'Must-have not found in the resume text — check manually or ask in the interview.',
    })),
    ...nice.filter((s) => !niceHits.includes(s)).map((requirement) => ({
      requirement,
      note: 'Nice-to-have not found.',
    })),
  ];

  const flags: string[] = [];
  if (resumeText.length < 400) flags.push('Very short resume text — the score may be unreliable.');
  if (job.minYears > 0 && profile.yearsExperience === null) flags.push('Years of experience could not be detected.');
  if (!must.length) flags.push('This job has no must-have skills, so only nice-to-haves and experience were scored.');

  const questions = gaps
    .filter((g) => must.includes(g.requirement))
    .slice(0, 3)
    .map((g) => `Can you describe your hands-on experience with ${g.requirement}?`);
  questions.push('Walk us through a recent result you are proud of and what you personally did.');

  const summary = must.length
    ? `Matches ${mustHits.length} of ${must.length} must-have skills and ${niceHits.length} of ${nice.length} nice-to-haves.`
    : `Matches ${niceHits.length} of ${nice.length} nice-to-have skills.`;

  return {
    profile,
    screening: {
      engine: 'rules',
      screenedAt: Date.now(),
      score,
      recommendation: recommendationFor(score),
      summary,
      matched,
      gaps,
      questions,
      confidence: resumeText.length < 400 ? 'low' : 'medium',
      flags,
    },
  };
}

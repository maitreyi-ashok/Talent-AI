/* Shared data model. Everything is stored in the browser (localStorage) — see README. */

export type Job = {
  id: string;
  title: string;
  department: string;
  location: string;
  description: string;
  mustHave: string[];
  niceToHave: string[];
  minYears: number;
  createdAt: number;
  test?: TestTemplate;
  sample?: boolean;
};

export type Stage = 'new' | 'screened' | 'test' | 'interview' | 'offer' | 'hired' | 'declined';
export const STAGES: Stage[] = ['new', 'screened', 'test', 'interview', 'offer', 'hired', 'declined'];
export const STAGE_LABEL: Record<Stage, string> = {
  new: 'New',
  screened: 'Screened',
  test: 'Test sent',
  interview: 'Interview',
  offer: 'Offer',
  hired: 'Hired',
  declined: 'Declined',
};

export type Recommendation = 'advance' | 'review' | 'hold';
export const REC_LABEL: Record<Recommendation, string> = {
  advance: 'Advance',
  review: 'Needs review',
  hold: 'Hold',
};

export type Profile = {
  name: string;
  email: string;
  headline: string;
  yearsExperience: number | null;
  skills: string[];
  education: string[];
};

export type Evidence = { requirement: string; evidence: string };
export type GapNote = { requirement: string; note: string };

export type ScreeningResult = {
  engine: 'ai' | 'rules';
  model?: string;
  screenedAt: number;
  score: number; // 0-100
  recommendation: Recommendation; // a suggestion — humans decide
  summary: string;
  matched: Evidence[];
  gaps: GapNote[];
  questions: string[];
  confidence: 'high' | 'medium' | 'low';
  flags: string[];
};

export type Candidate = {
  id: string;
  jobId: string;
  fileName: string;
  resumeText: string; // empty for PDFs (the file itself is never stored)
  profile: Profile;
  screening?: ScreeningResult;
  stage: Stage;
  /** Who last moved the candidate — the agent never counts as a human decision when learning from results. */
  stageBy?: 'human' | 'agent';
  notes: string;
  addedAt: number;
  test?: TestRun;
  interview?: InterviewRun;
  sample?: boolean;
};

/* ---------- HR agent: tests and video interviews ---------- */

export type Question = {
  id: string;
  type: 'mcq' | 'short';
  prompt: string;
  options?: string[]; // mcq
  correct?: number; // mcq: index into options
  rubric?: string; // short: what a good answer contains (never shown to candidates)
  points: number;
};

export type TestTemplate = {
  title: string;
  instructions: string;
  timeLimitMin: number;
  passMarkPct: number;
  questions: Question[];
  updatedAt: number;
};

export type DeliveryStatus = 'sent' | 'draft' | 'failed';

export type TestRun = {
  testId: string;
  link: string;
  sentAt: number;
  delivery: DeliveryStatus; // 'draft' = no email service configured; recruiter sends it manually
  deliveryError?: string;
  status: 'sent' | 'started' | 'submitted';
  submittedAt?: number;
  scorePct?: number;
  passed?: boolean;
  needsReview?: boolean; // free-text answers, late submission, etc.
  late?: boolean;
  decision?: 'pass' | 'fail'; // human override after review
};

export type InterviewRun = {
  id: string;
  link: string;
  startsAt: number;
  durationMin: number;
  delivery: DeliveryStatus;
  deliveryError?: string;
  status: 'scheduled' | 'completed' | 'cancelled';
};

export type AgentSettings = {
  companyName: string;
  threshold: number; // match score out of 10 needed before a test is offered
  testMode: 'ask' | 'auto';
  interviewMode: 'ask' | 'auto';
  testTimeLimitMin: number;
  passMarkPct: number;
  interviewDurationMin: number;
  interviewHour: number; // first slot of the day, 24h local
  /** Auto mode only acts on candidates screened after this moment, so switching it on never emails your back catalogue. */
  autoSince: number;
};

export const DEFAULT_SETTINGS: AgentSettings = {
  companyName: '',
  threshold: 7,
  testMode: 'ask',
  interviewMode: 'ask',
  testTimeLimitMin: 30,
  passMarkPct: 70,
  interviewDurationMin: 30,
  interviewHour: 10,
  autoSince: 0,
};

export type AgentEvent = {
  id: string;
  at: number;
  by: 'agent' | 'human';
  kind: 'test_sent' | 'test_result' | 'interview_created' | 'note' | 'error';
  candidateId?: string;
  text: string;
};

export type Requirement = { skill: string; target: number }; // target level 1-5
export type RoleProfile = { id: string; name: string; requirements: Requirement[]; sample?: boolean };

export type Signals = {
  tenureMonths: number | null;
  monthsSincePromotion: number | null;
  engagement: number | null; // latest pulse score 1-5
  oneOnOnesPerMonth: number | null;
  overtimeHoursPerWeek: number | null;
  compaRatio: number | null; // salary / band midpoint, e.g. 0.92
};

export type Employee = {
  id: string;
  name: string;
  roleId: string;
  skills: Record<string, number>; // lower-case skill -> level 0-5
  signals: Signals;
  sample?: boolean;
};

export type DB = {
  version: 1;
  jobs: Job[];
  candidates: Candidate[];
  roles: RoleProfile[];
  employees: Employee[];
  settings: AgentSettings;
  log: AgentEvent[];
};

export const emptySignals = (): Signals => ({
  tenureMonths: null,
  monthsSincePromotion: null,
  engagement: null,
  oneOnOnesPerMonth: null,
  overtimeHoursPerWeek: null,
  compaRatio: null,
});

export const skillKey = (s: string) => s.trim().toLowerCase();

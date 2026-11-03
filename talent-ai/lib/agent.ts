import { getDB, logEvent, update } from './store';
import { interviewInvite, testInvite } from './templates';
import type { AgentSettings, Candidate, DB, DeliveryStatus, InterviewRun, Job, Question, TestRun } from './types';

/**
 * The HR hiring agent. It follows a fixed, auditable path:
 *   screened with a match of at least the threshold  →  skills test  →  passed  →  video interview.
 * It never declines anyone, and anything with written answers or a late/odd result waits for a person.
 */

export type Api = <T>(method: 'GET' | 'POST' | 'DELETE', url: string, body?: unknown) => Promise<T>;

const EMAIL_RE = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]{2,}$/;
export const isEmail = (s: string) => EMAIL_RE.test(s.trim());
export const outOf10 = (c: Candidate) => (c.screening ? Math.round(c.screening.score) / 10 : null);
export const isMatched = (c: Candidate, s: AgentSettings) => Boolean(c.screening) && c.screening!.score / 10 >= s.threshold;

const CLOSED = new Set(['declined', 'hired', 'offer']);
const NO_NEW_TEST = new Set(['declined', 'hired', 'offer', 'interview']);
const activeInterview = (c: Candidate) => Boolean(c.interview && c.interview.status !== 'cancelled');

/* ---------- who is where ---------- */

export type TestBlocker = 'no_test' | 'no_email' | null;
export const testBlocker = (c: Candidate, job: Job | undefined): TestBlocker =>
  !job?.test?.questions.length ? 'no_test' : !isEmail(c.profile.email) ? 'no_email' : null;

export type Ready = { cand: Candidate; job: Job; blocker: TestBlocker };

export function readyForTest(db: DB): Ready[] {
  const out: Ready[] = [];
  for (const cand of db.candidates) {
    const job = db.jobs.find((j) => j.id === cand.jobId);
    if (!job || cand.test || NO_NEW_TEST.has(cand.stage) || !isMatched(cand, db.settings)) continue;
    out.push({ cand, job, blocker: testBlocker(cand, job) });
  }
  return out.sort((a, b) => (b.cand.screening?.score ?? 0) - (a.cand.screening?.score ?? 0));
}

export const testsOut = (db: DB) => db.candidates.filter((c) => c.test && c.test.status !== 'submitted' && !CLOSED.has(c.stage));

/** Passed outright, or a person marked it a pass. */
export const passedTest = (c: Candidate) => {
  const t = c.test;
  if (!t || t.status !== 'submitted') return false;
  if (t.decision) return t.decision === 'pass';
  return t.passed === true && !t.needsReview;
};

export const needsReview = (c: Candidate) => {
  const t = c.test;
  return Boolean(t && t.status === 'submitted' && !t.decision && (t.needsReview || t.passed === false) && c.stage !== 'declined');
};

export const readyForInterview = (db: DB) => db.candidates.filter((c) => passedTest(c) && !activeInterview(c) && !CLOSED.has(c.stage) && c.stage !== 'interview');
export const interviews = (db: DB) => db.candidates.filter((c) => c.interview && c.interview.status === 'scheduled');

export function funnel(db: DB) {
  const t = db.settings.threshold;
  return {
    screened: db.candidates.filter((c) => c.screening).length,
    matched: db.candidates.filter((c) => c.screening && c.screening.score / 10 >= t).length,
    tested: db.candidates.filter((c) => c.test).length,
    submitted: db.candidates.filter((c) => c.test?.status === 'submitted').length,
    passed: db.candidates.filter(passedTest).length,
    interviewing: db.candidates.filter((c) => c.interview && c.interview.status !== 'cancelled').length,
  };
}

/* ---------- interview slots ---------- */

const BUFFER_MIN = 15;
const DAY_END_HOUR = 17;

/** Proposes consecutive weekday slots, never overlapping interviews that already exist. Uses the browser's local time. */
export function proposeSlots(count: number, existing: { startsAt: number; durationMin: number }[], s: Pick<AgentSettings, 'interviewHour' | 'interviewDurationMin'>, from = Date.now()): number[] {
  const step = (s.interviewDurationMin + BUFFER_MIN) * 60_000;
  const dur = s.interviewDurationMin * 60_000;
  const day = new Date(from);
  day.setDate(day.getDate() + 1);
  const startOfDay = (d: Date) => {
    const x = new Date(d);
    while (x.getDay() === 0 || x.getDay() === 6) x.setDate(x.getDate() + 1);
    x.setHours(s.interviewHour, 0, 0, 0);
    return x;
  };
  let cursor = startOfDay(day);
  const out: number[] = [];
  const taken = existing.map((e) => [e.startsAt - BUFFER_MIN * 60_000, e.startsAt + e.durationMin * 60_000 + BUFFER_MIN * 60_000]);
  for (let guard = 0; guard < 400 && out.length < count; guard++) {
    const start = cursor.getTime();
    const end = start + dur;
    const endOfWorkday = new Date(cursor);
    endOfWorkday.setHours(DAY_END_HOUR, 0, 0, 0);
    if (end > endOfWorkday.getTime()) {
      const next = new Date(cursor);
      next.setDate(next.getDate() + 1);
      cursor = startOfDay(next);
      continue;
    }
    if (taken.some(([a, b]) => start < b && end > a)) {
      cursor = new Date(start + step);
      continue;
    }
    out.push(start);
    taken.push([start - BUFFER_MIN * 60_000, end + BUFFER_MIN * 60_000]);
    cursor = new Date(start + step);
  }
  return out;
}

/* ---------- email drafts (used when no email service is configured) ---------- */

export function mailto(kind: 'test' | 'interview', cand: Candidate, job: Job, link: string, company: string, extra: { timeLimitMin?: number; startsAt?: number; durationMin?: number } = {}) {
  const params = { candidateName: cand.profile.name, jobTitle: job.title, company, link, ...extra, timeZoneLabel: Intl.DateTimeFormat().resolvedOptions().timeZone };
  const m = kind === 'test' ? testInvite(params) : interviewInvite(params);
  return `mailto:${encodeURIComponent(cand.profile.email.trim())}?subject=${encodeURIComponent(m.subject)}&body=${encodeURIComponent(m.text)}`;
}

/* ---------- actions ---------- */

const patch = (id: string, fn: (c: Candidate) => Candidate) => update((db) => ({ ...db, candidates: db.candidates.map((c) => (c.id === id ? fn(c) : c)) }));

async function deliver(api: Api, mailReady: boolean, type: 'test_invite' | 'interview_invite', to: string, params: Record<string, unknown>): Promise<{ delivery: DeliveryStatus; error?: string }> {
  if (!mailReady) return { delivery: 'draft' };
  try {
    await api('POST', '/api/agent/email', { type, to, params });
    return { delivery: 'sent' };
  } catch (e) {
    const code = (e as { code?: string }).code;
    return code === 'mail_not_configured' ? { delivery: 'draft' } : { delivery: 'failed', error: e instanceof Error ? e.message : 'Email failed' };
  }
}

export async function sendTest(api: Api, mailReady: boolean, cand: Candidate, job: Job, origin: string, by: 'agent' | 'human'): Promise<{ ok: boolean; message?: string }> {
  const t = job.test;
  const s = getDB().settings;
  if (!t?.questions.length) return { ok: false, message: 'This job has no test yet.' };
  if (!isEmail(cand.profile.email)) return { ok: false, message: 'No valid email address for this candidate.' };
  try {
    const { id } = await api<{ id: string }>('POST', '/api/agent/tests', {
      jobTitle: job.title,
      candidateName: cand.profile.name,
      title: t.title,
      instructions: t.instructions,
      timeLimitMin: t.timeLimitMin,
      passMarkPct: t.passMarkPct,
      questions: t.questions,
    });
    const link = `${origin}/test/${id}`;
    const mail = await deliver(api, mailReady, 'test_invite', cand.profile.email.trim(), {
      candidateName: cand.profile.name,
      jobTitle: job.title,
      company: s.companyName,
      link,
      timeLimitMin: t.timeLimitMin,
    });
    const run: TestRun = { testId: id, link, sentAt: Date.now(), delivery: mail.delivery, deliveryError: mail.error, status: 'sent' };
    patch(cand.id, (c) => ({ ...c, test: run, stage: 'test', stageBy: by }));
    logEvent({ by, kind: 'test_sent', candidateId: cand.id, text: `Test created for ${cand.profile.name || cand.fileName} (match ${outOf10(cand)}/10) — ${mail.delivery === 'sent' ? 'email sent' : mail.delivery === 'draft' ? 'email draft ready to send' : `email failed: ${mail.error}`}.` });
    return { ok: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Could not create the test.';
    logEvent({ by, kind: 'error', candidateId: cand.id, text: `Could not send a test to ${cand.profile.name || cand.fileName}: ${message}` });
    return { ok: false, message };
  }
}

export async function resendTestEmail(api: Api, mailReady: boolean, cand: Candidate, job: Job): Promise<{ ok: boolean; message?: string }> {
  if (!cand.test) return { ok: false, message: 'No test to resend.' };
  const mail = await deliver(api, mailReady, 'test_invite', cand.profile.email.trim(), {
    candidateName: cand.profile.name,
    jobTitle: job.title,
    company: getDB().settings.companyName,
    link: cand.test.link,
    timeLimitMin: job.test?.timeLimitMin,
  });
  patch(cand.id, (c) => (c.test ? { ...c, test: { ...c.test, delivery: mail.delivery, deliveryError: mail.error } } : c));
  return mail.delivery === 'sent' ? { ok: true } : { ok: false, message: mail.error || 'Email is not configured — use the draft.' };
}

type TestStatus = {
  status: 'sent' | 'started' | 'submitted';
  scorePct?: number;
  passed?: boolean;
  needsReview?: boolean;
  late?: boolean;
  submittedAt?: number;
};

/** Ask the server how a candidate's test is going; returns true if something changed. */
export async function checkTest(api: Api, cand: Candidate): Promise<boolean> {
  if (!cand.test || cand.test.status === 'submitted') return false;
  try {
    const r = await api<TestStatus>('GET', `/api/agent/tests/${cand.test.testId}`);
    if (r.status === cand.test.status) return false;
    patch(cand.id, (c) =>
      c.test ? { ...c, test: { ...c.test, status: r.status, scorePct: r.scorePct, passed: r.passed, needsReview: r.needsReview, late: r.late, submittedAt: r.submittedAt } } : c,
    );
    if (r.status === 'submitted') {
      logEvent({
        by: 'agent',
        kind: 'test_result',
        candidateId: cand.id,
        text: `${cand.profile.name || cand.fileName} submitted the test: ${r.scorePct}% — ${r.needsReview ? 'needs your review' : r.passed ? 'passed' : 'below the pass mark'}.`,
      });
    }
    return true;
  } catch {
    return false;
  }
}

export async function createInterview(api: Api, mailReady: boolean, cand: Candidate, job: Job, startsAt: number, durationMin: number, origin: string, by: 'agent' | 'human'): Promise<{ ok: boolean; message?: string }> {
  if (!isEmail(cand.profile.email)) return { ok: false, message: 'No valid email address for this candidate.' };
  const company = getDB().settings.companyName;
  try {
    const { id } = await api<{ id: string }>('POST', '/api/agent/interviews', { jobTitle: job.title, candidateName: cand.profile.name, startsAt, durationMin });
    const link = `${origin}/interview/${id}`;
    const mail = await deliver(api, mailReady, 'interview_invite', cand.profile.email.trim(), {
      candidateName: cand.profile.name,
      jobTitle: job.title,
      company,
      link,
      startsAt,
      durationMin,
      timeZoneLabel: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
    const run: InterviewRun = { id, link, startsAt, durationMin, delivery: mail.delivery, deliveryError: mail.error, status: 'scheduled' };
    patch(cand.id, (c) => ({ ...c, interview: run, stage: 'interview', stageBy: by }));
    logEvent({ by, kind: 'interview_created', candidateId: cand.id, text: `Video interview booked for ${cand.profile.name || cand.fileName} on ${new Date(startsAt).toLocaleString()} — ${mail.delivery === 'sent' ? 'invitation emailed' : mail.delivery === 'draft' ? 'invitation draft ready' : `email failed: ${mail.error}`}.` });
    return { ok: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Could not create the interview.';
    logEvent({ by, kind: 'error', candidateId: cand.id, text: `Could not book an interview for ${cand.profile.name || cand.fileName}: ${message}` });
    return { ok: false, message };
  }
}

export async function cancelInterview(api: Api, cand: Candidate): Promise<void> {
  if (!cand.interview) return;
  try {
    await api('DELETE', `/api/agent/interviews/${cand.interview.id}`);
  } catch {
    /* the local record is still marked cancelled below */
  }
  patch(cand.id, (c) => (c.interview ? { ...c, interview: { ...c.interview, status: 'cancelled' } } : c));
  logEvent({ by: 'human', kind: 'note', candidateId: cand.id, text: `Interview cancelled for ${cand.profile.name || cand.fileName}.` });
}

/* ---------- automatic mode ---------- */

const MAX_AUTO_PER_RUN = 10;
let running = false;

/**
 * One pass of the agent: refresh pending tests and, in auto mode, send tests / book interviews.
 * Auto mode only acts on people screened after it was switched on, at most 10 per pass, and only when
 * email is actually configured (so nothing "auto" is left half-done as a draft).
 */
export async function runAgentOnce(api: Api, mailReady: boolean, origin: string): Promise<void> {
  if (running) return;
  running = true;
  try {
    for (const c of testsOut(getDB())) await checkTest(api, c);

    const db = getDB();
    const s = db.settings;
    if (!mailReady) return;

    if (s.testMode === 'auto') {
      const todo = readyForTest(db).filter((r) => !r.blocker && (r.cand.screening?.screenedAt ?? 0) >= s.autoSince).slice(0, MAX_AUTO_PER_RUN);
      for (const r of todo) await sendTest(api, mailReady, getDB().candidates.find((c) => c.id === r.cand.id) ?? r.cand, r.job, origin, 'agent');
    }

    if (s.interviewMode === 'auto') {
      const fresh = getDB();
      const todo = readyForInterview(fresh)
        .filter((c) => isEmail(c.profile.email) && (c.test?.sentAt ?? 0) >= s.autoSince && !c.test?.decision) // people-approved passes go through the normal queue
        .slice(0, MAX_AUTO_PER_RUN);
      if (todo.length) {
        const booked = interviews(fresh).map((c) => ({ startsAt: c.interview!.startsAt, durationMin: c.interview!.durationMin }));
        const slots = proposeSlots(todo.length, booked, s);
        for (let i = 0; i < todo.length; i++) {
          const job = fresh.jobs.find((j) => j.id === todo[i].jobId);
          if (job) await createInterview(api, mailReady, todo[i], job, slots[i], s.interviewDurationMin, origin, 'agent');
        }
      }
    }
  } finally {
    running = false;
  }
}

/* ---------- test builder helpers ---------- */

export const newQuestionId = () => 'q' + Math.random().toString(36).slice(2, 10);
export const blankQuestion = (type: Question['type']): Question =>
  type === 'mcq' ? { id: newQuestionId(), type, prompt: '', options: ['', '', '', ''], correct: 0, points: 1 } : { id: newQuestionId(), type, prompt: '', rubric: '', points: 3 };

export function validateTemplate(t: { questions: Question[]; timeLimitMin: number; passMarkPct: number }): string | null {
  if (!t.questions.length) return 'Add at least one question.';
  for (const [i, q] of t.questions.entries()) {
    if (!q.prompt.trim()) return `Question ${i + 1} has no text.`;
    if (q.type === 'mcq') {
      const opts = (q.options ?? []).filter((o) => o.trim());
      if (opts.length < 2) return `Question ${i + 1} needs at least two answer options.`;
      if (q.correct === undefined || !(q.options ?? [])[q.correct]?.trim()) return `Question ${i + 1}: choose the correct answer.`;
    }
  }
  if (t.timeLimitMin < 5 || t.timeLimitMin > 180) return 'The time limit must be 5–180 minutes.';
  if (t.passMarkPct < 1 || t.passMarkPct > 100) return 'The pass mark must be 1–100%.';
  return null;
}

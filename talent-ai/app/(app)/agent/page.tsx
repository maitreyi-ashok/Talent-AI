'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { update, useDB } from '@/lib/store';
import { useAI } from '@/lib/ai-client';
import { addSampleData } from '@/lib/sample';
import {
  blankQuestion, cancelInterview, checkTest, createInterview, funnel, interviews, isEmail, mailto, needsReview,
  outOf10, proposeSlots, readyForInterview, readyForTest, resendTestEmail, sendTest, testsOut, validateTemplate,
} from '@/lib/agent';
import type { AgentSettings, Candidate, Job, Question } from '@/lib/types';
import { Badge, Empty, Field, Modal, Notice } from '@/components/ui';

const when = (ms: number) => new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const toLocalInput = (ms: number) => {
  const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 16);
};
const name = (c: Candidate) => c.profile.name || c.fileName;
const patchCand = (id: string, fn: (c: Candidate) => Candidate) => update((db) => ({ ...db, candidates: db.candidates.map((c) => (c.id === id ? fn(c) : c)) }));
const copy = (t: string) => void navigator.clipboard?.writeText(t);

/* ============================== Test builder ============================== */

function TestBuilder({ job, onClose }: { job: Job; onClose: () => void }) {
  const ai = useAI();
  const db = useDB();
  const t = job.test;
  const [title, setTitle] = useState(t?.title ?? `Assessment — ${job.title}`);
  const [instructions, setInstructions] = useState(t?.instructions ?? 'Answer every question on your own. Once you start, the timer keeps running even if you close the page. There are no trick questions — we just want to see how you work.');
  const [timeLimitMin, setTime] = useState(String(t?.timeLimitMin ?? db.settings.testTimeLimitMin));
  const [passMarkPct, setPass] = useState(String(t?.passMarkPct ?? db.settings.passMarkPct));
  const [qs, setQs] = useState<Question[]>(t?.questions ?? []);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [genMcq, setGenMcq] = useState('8');
  const [genShort, setGenShort] = useState('2');

  const setQ = (i: number, p: Partial<Question>) => setQs((prev) => prev.map((q, j) => (j === i ? { ...q, ...p } : q)));

  const generate = async () => {
    setBusy(true);
    setErr('');
    try {
      const r = await ai.api<{ questions: Question[] }>('POST', '/api/agent/generate-test', {
        job: { title: job.title, mustHave: job.mustHave, niceToHave: job.niceToHave, description: job.description },
        mcq: Number(genMcq),
        short: Number(genShort),
      });
      setQs((prev) => [...prev, ...r.questions]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not generate questions.');
    }
    setBusy(false);
  };

  const save = () => {
    const draft = { questions: qs, timeLimitMin: Number(timeLimitMin), passMarkPct: Number(passMarkPct) };
    const problem = validateTemplate(draft);
    if (problem) return setErr(problem);
    update((d) => ({
      ...d,
      jobs: d.jobs.map((j) => (j.id === job.id ? { ...j, test: { title: title.trim() || `Assessment — ${job.title}`, instructions: instructions.trim(), ...draft, updatedAt: Date.now() } } : j)),
    }));
    onClose();
  };

  return (
    <Modal title={`Test for ${job.title}`} onClose={onClose} wide>
      <p className="muted small">Candidates who match well receive this test by link. Multiple-choice answers are marked automatically. Written answers are read by you (AI gives a first suggested mark if enabled). Review every question before you send — you are responsible for the content.</p>
      <div className="form-grid">
        <div className="span-2"><Field label="Test title"><input type="text" value={title} onChange={(e) => setTitle(e.target.value)} /></Field></div>
        <div className="span-2"><Field label="Instructions shown to the candidate"><textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} /></Field></div>
        <Field label="Time limit (minutes)"><input type="number" min={5} max={180} value={timeLimitMin} onChange={(e) => setTime(e.target.value)} /></Field>
        <Field label="Pass mark (%)"><input type="number" min={1} max={100} value={passMarkPct} onChange={(e) => setPass(e.target.value)} /></Field>
      </div>

      <div className="card card--flat stack">
        <div className="row row--between">
          <strong>Questions ({qs.length})</strong>
          <div className="row">
            <button type="button" className="btn btn--sm" onClick={() => setQs([...qs, blankQuestion('mcq')])}>+ Multiple choice</button>
            <button type="button" className="btn btn--sm" onClick={() => setQs([...qs, blankQuestion('short')])}>+ Written answer</button>
          </div>
        </div>
        {ai.aiOn && (
          <div className="row small">
            <span>Draft with AI:</span>
            <input type="number" min={0} max={15} value={genMcq} onChange={(e) => setGenMcq(e.target.value)} style={{ width: 64 }} aria-label="Multiple-choice count" /> multiple choice +
            <input type="number" min={0} max={4} value={genShort} onChange={(e) => setGenShort(e.target.value)} style={{ width: 64 }} aria-label="Written answer count" /> written
            <button type="button" className="btn btn--sm btn--primary" onClick={generate} disabled={busy}>{busy ? 'Drafting…' : 'Generate'}</button>
          </div>
        )}
        {qs.length === 0 && <p className="muted small">No questions yet. {ai.aiOn ? 'Generate a draft or add your own.' : 'Add your own questions (an AI key would let you generate a draft).'}</p>}
        {qs.map((q, i) => (
          <div key={q.id} className="card card--flat stack" style={{ padding: 14 }}>
            <div className="row row--between">
              <Badge tone={q.type === 'mcq' ? 'info' : 'neutral'}>{i + 1}. {q.type === 'mcq' ? 'Multiple choice' : 'Written answer'}</Badge>
              <div className="row">
                <label className="row small">Points <input type="number" min={1} max={20} value={q.points} onChange={(e) => setQ(i, { points: Math.max(1, Number(e.target.value) || 1) })} style={{ width: 64 }} /></label>
                <button type="button" className="btn btn--sm btn--danger" onClick={() => setQs(qs.filter((_, j) => j !== i))}>Remove</button>
              </div>
            </div>
            <textarea aria-label={`Question ${i + 1}`} value={q.prompt} onChange={(e) => setQ(i, { prompt: e.target.value })} placeholder="Question" style={{ minHeight: 64 }} />
            {q.type === 'mcq' ? (
              <div className="stack" style={{ gap: 8 }}>
                {(q.options ?? []).map((o, k) => (
                  <label key={k} className="row">
                    <input type="radio" name={`c-${q.id}`} checked={q.correct === k} onChange={() => setQ(i, { correct: k })} aria-label={`Option ${k + 1} is correct`} />
                    <input type="text" className="grow" value={o} placeholder={`Option ${k + 1}`} onChange={(e) => setQ(i, { options: (q.options ?? []).map((x, m) => (m === k ? e.target.value : x)) })} />
                  </label>
                ))}
                <span className="small faint">Select the radio button next to the correct answer.</span>
              </div>
            ) : (
              <Field label="What a good answer contains (only you and the grader see this)">
                <textarea value={q.rubric ?? ''} onChange={(e) => setQ(i, { rubric: e.target.value })} style={{ minHeight: 64 }} />
              </Field>
            )}
          </div>
        ))}
      </div>
      {err && <Notice tone="bad">{err}</Notice>}
      <div className="modal__foot">
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn--primary" onClick={save}>Save test</button>
      </div>
    </Modal>
  );
}

/* ============================== Review a submitted test ============================== */

type ReviewItem = { prompt: string; type: 'mcq' | 'short'; answer: string; correctAnswer?: string; rubric?: string; earned: number; max: number; note?: string };
type ReviewData = { scorePct: number; passed: boolean; needsReview: boolean; late: boolean; passMarkPct: number; review: ReviewItem[] };

function ReviewModal({ cand, onClose }: { cand: Candidate; onClose: () => void }) {
  const ai = useAI();
  const [data, setData] = useState<ReviewData | null>(null);
  const [err, setErr] = useState('');
  const testId = cand.test?.testId;
  useEffect(() => {
    if (!testId) return;
    ai.api<ReviewData>('GET', `/api/agent/tests/${testId}`).then(setData).catch((e) => setErr(e instanceof Error ? e.message : 'Could not load.'));
  }, [ai.api, testId]);
  return (
    <Modal title={`Test answers — ${name(cand)}`} onClose={onClose} wide>
      {err && <Notice tone="bad">{err}</Notice>}
      {!data && !err && <p className="muted">Loading…</p>}
      {data && (
        <>
          <div className="row">
            <Badge tone={data.passed ? 'good' : 'bad'}>{data.scorePct}% {data.passed ? '(at or above pass mark)' : `(pass mark ${data.passMarkPct}%)`}</Badge>
            {data.late && <Badge tone="warn">Submitted after the time limit</Badge>}
          </div>
          {data.review.some((r) => r.type === 'short') && <Notice tone="info">Marks for written answers are a first suggestion (from AI if enabled, otherwise zero). Please read them and use your own judgement.</Notice>}
          {data.review.map((r, i) => (
            <div key={i} className={`evidence${r.earned >= r.max ? '' : ' evidence--gap'}`}>
              <strong>{i + 1}. {r.prompt}</strong>
              <div className="small"><span className="muted">Answer:</span> {r.answer || <em>no answer</em>}</div>
              {r.correctAnswer && r.earned < r.max && <div className="small muted">Correct answer: {r.correctAnswer}</div>}
              {r.rubric && <div className="small muted">Looking for: {r.rubric}</div>}
              <div className="small">{r.earned}/{r.max} points{r.note ? ` — ${r.note}` : ''}</div>
            </div>
          ))}
        </>
      )}
      <div className="modal__foot"><button type="button" className="btn btn--primary" onClick={onClose}>Close</button></div>
    </Modal>
  );
}

/* ============================== Interview guide ============================== */

function GuideModal({ cand, job, onClose }: { cand: Candidate; job: Job; onClose: () => void }) {
  const ai = useAI();
  const [guide, setGuide] = useState<{ focus: string[]; questions: { question: string; why: string }[] } | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const make = async () => {
    setBusy(true);
    setErr('');
    try {
      let missed: string[] = [];
      try {
        const r = await ai.api<ReviewData>('GET', `/api/agent/tests/${cand.test!.testId}`);
        missed = r.review.filter((x) => x.earned < x.max).map((x) => x.prompt);
      } catch {
        /* guide still works without it */
      }
      // no name, email or other personal details are sent
      setGuide(await ai.api('POST', '/api/agent/guide', { jobTitle: job.title, mustHave: job.mustHave, gaps: (cand.screening?.gaps ?? []).map((g) => g.requirement), missed, testScorePct: cand.test?.scorePct }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not prepare the guide.');
    }
    setBusy(false);
  };

  return (
    <Modal title={`Interview guide — ${name(cand)}`} onClose={onClose}>
      <p className="muted small">AI suggests what to explore, based on the job, resume gaps and missed test topics. Your name, email and personal details are not sent.</p>
      {!guide && <div><button type="button" className="btn btn--primary" onClick={make} disabled={busy}>{busy ? 'Preparing…' : 'Prepare guide'}</button></div>}
      {err && <Notice tone="bad">{err}</Notice>}
      {guide && (
        <div className="stack">
          {guide.focus.length > 0 && <div><h3>Focus on</h3><ul style={{ margin: '6px 0 0', paddingLeft: 20 }}>{guide.focus.map((f) => <li key={f}>{f}</li>)}</ul></div>}
          {guide.questions.map((q) => (
            <div key={q.question} className="evidence"><strong>{q.question}</strong><div className="small muted">{q.why}</div></div>
          ))}
        </div>
      )}
      <div className="modal__foot"><button type="button" className="btn btn--primary" onClick={onClose}>Close</button></div>
    </Modal>
  );
}

/* ============================== Settings ============================== */

function Settings({ s, mailReady }: { s: AgentSettings; mailReady: boolean }) {
  const set = (p: Partial<AgentSettings>) => update((d) => ({ ...d, settings: { ...d.settings, ...p } }));
  const num = (v: string, d: number) => (v === '' || !Number.isFinite(Number(v)) ? d : Number(v));
  const mode = (key: 'testMode' | 'interviewMode', label: string, autoText: string) => (
    <div className="stack" style={{ gap: 6 }}>
      <span className="field__label">{label}</span>
      <div className="seg" role="group" aria-label={label}>
        <button type="button" aria-pressed={s[key] === 'ask'} onClick={() => set({ [key]: 'ask' } as Partial<AgentSettings>)}>Ask me first</button>
        <button
          type="button"
          aria-pressed={s[key] === 'auto'}
          disabled={!mailReady}
          title={mailReady ? '' : 'Needs an email service so invitations are really sent'}
          onClick={() => {
            if (confirm(`${autoText}\n\nIt only acts on candidates screened from now on, at most 10 at a time, and only while this app is open. Switch to automatic?`)) set({ [key]: 'auto', autoSince: Date.now() } as Partial<AgentSettings>);
          }}
        >
          Automatic
        </button>
      </div>
    </div>
  );
  return (
    <div className="card stack">
      <h2>Rules</h2>
      <div className="form-grid">
        <Field label="Company name (used in emails)"><input type="text" value={s.companyName} onChange={(e) => set({ companyName: e.target.value })} placeholder="Optional" /></Field>
        <Field label="Send a test when the match is at least" hint="Match score out of 10 from resume screening.">
          <input type="number" min={0} max={10} step={0.5} value={s.threshold} onChange={(e) => set({ threshold: Math.max(0, Math.min(10, num(e.target.value, 7))) })} />
        </Field>
        <Field label="Interview length (minutes)"><input type="number" min={10} max={180} value={s.interviewDurationMin} onChange={(e) => set({ interviewDurationMin: Math.max(10, Math.min(180, num(e.target.value, 30))) })} /></Field>
        <Field label="First interview slot each day (hour, 0–23, your local time)"><input type="number" min={0} max={23} value={s.interviewHour} onChange={(e) => set({ interviewHour: Math.max(0, Math.min(23, num(e.target.value, 10))) })} /></Field>
      </div>
      <div className="row" style={{ gap: 24, alignItems: 'flex-start' }}>
        {mode('testMode', 'Sending tests', 'The agent will email a test to every new candidate who matches.')}
        {mode('interviewMode', 'Booking video interviews', 'The agent will book and email a video interview for every candidate who passes a multiple-choice test.')}
      </div>
      {!mailReady && <p className="small muted">Automatic mode needs an email service (see Settings). Until then the agent prepares drafts for you to send.</p>}
    </div>
  );
}

/* ============================== Page ============================== */

export default function AgentPage() {
  const db = useDB();
  const ai = useAI();
  const mailReady = Boolean(ai.status?.mailReady);
  const s = db.settings;

  const [builderJob, setBuilderJob] = useState<string | null>(null);
  const [review, setReview] = useState<string | null>(null);
  const [guideFor, setGuideFor] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [slotInputs, setSlotInputs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');
  const [notes, setNotes] = useState<string[]>([]);

  const ready = useMemo(() => readyForTest(db), [db]);
  const sendable = ready.filter((r) => !r.blocker);
  const out = useMemo(() => testsOut(db), [db]);
  const toReview = useMemo(() => db.candidates.filter(needsReview), [db]);
  const forInterview = useMemo(() => readyForInterview(db), [db]);
  const booked = useMemo(() => interviews(db), [db]);
  const f = useMemo(() => funnel(db), [db]);
  const origin = typeof window === 'undefined' ? '' : window.location.origin;

  const proposed = useMemo(
    () => proposeSlots(forInterview.length, booked.map((c) => ({ startsAt: c.interview!.startsAt, durationMin: c.interview!.durationMin })), s),
    [forInterview.length, booked, s],
  );
  const slotFor = (c: Candidate, i: number) => slotInputs[c.id] ?? (proposed[i] ? toLocalInput(proposed[i]) : '');

  const note = (m: string) => setNotes((p) => [...new Set([...p, m])].slice(-5));

  const doSend = useCallback(
    async (rows: { cand: Candidate; job: Job }[]) => {
      setNotes([]);
      for (const [i, r] of rows.entries()) {
        setBusy(`Sending test ${i + 1} of ${rows.length}…`);
        const res = await sendTest(ai.api, mailReady, r.cand, r.job, origin, 'human');
        if (!res.ok) note(`${name(r.cand)}: ${res.message}`);
      }
      setBusy('');
      setPicked(new Set());
    },
    [ai.api, mailReady, origin],
  );

  const doBook = async (cands: Candidate[]) => {
    setNotes([]);
    for (const [i, c] of cands.entries()) {
      const job = db.jobs.find((j) => j.id === c.jobId);
      const at = Date.parse(slotFor(c, forInterview.indexOf(c)));
      if (!job || !Number.isFinite(at)) {
        note(`${name(c)}: choose a valid date and time.`);
        continue;
      }
      setBusy(`Booking ${i + 1} of ${cands.length}…`);
      const res = await createInterview(ai.api, mailReady, c, job, at, s.interviewDurationMin, origin, 'human');
      if (!res.ok) note(`${name(c)}: ${res.message}`);
    }
    setBusy('');
  };

  const checkNow = async () => {
    setBusy('Checking for submitted tests…');
    for (const c of out) await checkTest(ai.api, c);
    setBusy('');
  };

  const openRoom = async (c: Candidate) => {
    const w = window.open('', '_blank');
    try {
      const r = await ai.api<{ roomUrl: string }>('GET', `/api/agent/interviews/${c.interview!.id}`);
      if (w) w.location.href = r.roomUrl;
    } catch (e) {
      w?.close();
      note(e instanceof Error ? e.message : 'Could not open the room.');
    }
  };

  const jobWithBuilder = db.jobs.find((j) => j.id === builderJob);
  const reviewCand = db.candidates.find((c) => c.id === review);
  const guideCand = db.candidates.find((c) => c.id === guideFor);
  const guideJob = guideCand ? db.jobs.find((j) => j.id === guideCand.jobId) : undefined;

  if (!db.jobs.length) {
    return (
      <>
        <div className="page-head"><div><h1>HR hiring agent</h1><p>Sends skills tests to your best-matched candidates, then books video interviews for those who pass.</p></div></div>
        <Empty title="Create a job and screen a few resumes first">
          <p>The agent works from your screening results. Start on the Hiring page.</p>
          <div className="row"><a className="btn btn--primary" href="/hiring">Go to Hiring</a><button type="button" className="btn" onClick={addSampleData}>Try with fictional sample data</button></div>
        </Empty>
      </>
    );
  }

  return (
    <div className="stack stack--lg">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <h1>HR hiring agent</h1>
          <p>Match {s.threshold}/10 or better → skills test → pass → video interview. The agent prepares and sends; you decide who is hired and who is declined.</p>
        </div>
        {busy && <Badge tone="info">{busy}</Badge>}
      </div>

      {!mailReady && <Notice tone="info">Email is not configured, so the agent prepares ready-to-send drafts (and a link to copy) instead of emailing candidates itself. See Settings to add an email service.</Notice>}
      {notes.map((n) => <Notice key={n} tone="warn">{n}</Notice>)}

      <div className="grid grid--4">
        {[
          ['Screened', f.screened],
          [`Match ≥ ${s.threshold}/10`, f.matched],
          ['Tests sent', f.tested],
          ['Tests passed', f.passed],
        ].map(([l, v]) => (
          <div key={l} className="card"><div className="stat__value">{v}</div><div className="stat__label">{l}</div></div>
        ))}
      </div>

      <Settings s={s} mailReady={mailReady} />

      <section className="card stack">
        <h2>Tests</h2>
        {db.jobs.map((j) => (
          <div key={j.id} className="row row--between">
            <div><strong>{j.title}</strong> <span className="small muted">{j.test ? `· ${j.test.questions.length} questions · ${j.test.timeLimitMin} min · pass ${j.test.passMarkPct}%` : '· no test yet'}</span></div>
            <button type="button" className="btn btn--sm" onClick={() => setBuilderJob(j.id)}>{j.test ? 'Edit test' : 'Build test'}</button>
          </div>
        ))}
      </section>

      <section className="card stack">
        <div className="row row--between">
          <h2>Ready for a test ({ready.length})</h2>
          {sendable.length > 0 && (
            <button type="button" className="btn btn--primary" disabled={Boolean(busy) || !picked.size} onClick={() => confirm(`Send the test to ${picked.size} candidate${picked.size > 1 ? 's' : ''}?`) && void doSend(sendable.filter((r) => picked.has(r.cand.id)))}>
              Send test to {picked.size || '…'} selected
            </button>
          )}
        </div>
        {ready.length === 0 && <p className="muted small">No one is waiting. Candidates appear here when their resume match reaches {s.threshold}/10.</p>}
        {sendable.length > 1 && (
          <label className="row small"><input type="checkbox" checked={picked.size === sendable.length} onChange={(e) => setPicked(e.target.checked ? new Set(sendable.map((r) => r.cand.id)) : new Set())} /> Select all that can be sent</label>
        )}
        {ready.map(({ cand, job, blocker }) => (
          <div key={cand.id} className="row row--between" style={{ borderTop: '1px solid var(--line)', paddingTop: 10 }}>
            <label className="row grow" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
              <input type="checkbox" disabled={Boolean(blocker)} checked={picked.has(cand.id)} onChange={(e) => setPicked((p) => { const n = new Set(p); if (e.target.checked) n.add(cand.id); else n.delete(cand.id); return n; })} aria-label={`Select ${name(cand)}`} />
              <span><strong>{name(cand)}</strong> <span className="small muted">· {job.title} · match {outOf10(cand)}/10</span></span>
            </label>
            {blocker === 'no_test' && <button type="button" className="btn btn--sm" onClick={() => setBuilderJob(job.id)}>Build the test first</button>}
            {blocker === 'no_email' && (
              <input type="text" placeholder="Add email address" aria-label={`Email for ${name(cand)}`} style={{ maxWidth: 240 }} defaultValue="" onBlur={(e) => isEmail(e.target.value) && patchCand(cand.id, (c) => ({ ...c, profile: { ...c.profile, email: e.target.value.trim() } }))} />
            )}
          </div>
        ))}
      </section>

      <section className="card stack">
        <div className="row row--between"><h2>Waiting for results ({out.length})</h2><button type="button" className="btn btn--sm" onClick={checkNow} disabled={Boolean(busy) || !out.length}>Check now</button></div>
        {out.length === 0 && <p className="muted small">No tests are out. The agent checks automatically every minute while this app is open.</p>}
        {out.map((c) => {
          const job = db.jobs.find((j) => j.id === c.jobId)!;
          const t = c.test!;
          return (
            <div key={c.id} className="row row--between" style={{ borderTop: '1px solid var(--line)', paddingTop: 10 }}>
              <div><strong>{name(c)}</strong> <span className="small muted">· sent {when(t.sentAt)} · {t.status === 'started' ? 'in progress' : 'not started'}</span>
                {t.delivery !== 'sent' && <div className="small" style={{ color: 'var(--warn)' }}>{t.delivery === 'failed' ? `Email failed: ${t.deliveryError}` : 'Email not sent automatically — send the draft below.'}</div>}</div>
              <div className="row">
                {t.delivery !== 'sent' && <a className="btn btn--sm" href={mailto('test', c, job, t.link, s.companyName, { timeLimitMin: job.test?.timeLimitMin })}>Open email draft</a>}
                {t.delivery === 'failed' && mailReady && <button type="button" className="btn btn--sm" onClick={() => void resendTestEmail(ai.api, mailReady, c, job)}>Retry email</button>}
                <button type="button" className="btn btn--sm" onClick={() => copy(t.link)}>Copy link</button>
              </div>
            </div>
          );
        })}
      </section>

      <section className="card stack">
        <h2>Needs your review ({toReview.length})</h2>
        {toReview.length === 0 && <p className="muted small">Nothing to review. Tests with written answers, late submissions, or scores under the pass mark wait here for you — the agent never declines anyone.</p>}
        {toReview.map((c) => {
          const t = c.test!;
          const why = t.passed === false && !t.needsReview ? 'below the pass mark' : t.late ? 'submitted late' : 'has written answers';
          return (
            <div key={c.id} className="row row--between" style={{ borderTop: '1px solid var(--line)', paddingTop: 10 }}>
              <div><strong>{name(c)}</strong> <span className="small muted">· {t.scorePct}% · {why}</span></div>
              <div className="row">
                <button type="button" className="btn btn--sm" onClick={() => setReview(c.id)}>View answers</button>
                <button type="button" className="btn btn--sm btn--primary" onClick={() => patchCand(c.id, (x) => ({ ...x, test: x.test && { ...x.test, decision: 'pass' } }))}>Mark as passed</button>
                <button type="button" className="btn btn--sm" onClick={() => patchCand(c.id, (x) => ({ ...x, test: x.test && { ...x.test, decision: 'fail' } }))}>Not passed</button>
                <button type="button" className="btn btn--sm btn--danger" onClick={() => confirm(`Decline ${name(c)}? You are making this decision — no message is sent automatically.`) && patchCand(c.id, (x) => ({ ...x, stage: 'declined', stageBy: 'human', test: x.test && { ...x.test, decision: 'fail' } }))}>Decline</button>
              </div>
            </div>
          );
        })}
      </section>

      <section className="card stack">
        <div className="row row--between">
          <h2>Passed — ready for a video interview ({forInterview.length})</h2>
          {forInterview.length > 1 && <button type="button" className="btn btn--primary" disabled={Boolean(busy)} onClick={() => confirm(`Book and invite all ${forInterview.length} candidates?`) && void doBook(forInterview)}>Book all</button>}
        </div>
        {forInterview.length === 0 && <p className="muted small">Candidates who pass appear here with a suggested time slot you can change.</p>}
        {forInterview.map((c, i) => (
          <div key={c.id} className="row row--between" style={{ borderTop: '1px solid var(--line)', paddingTop: 10 }}>
            <div><strong>{name(c)}</strong> <span className="small muted">· test {c.test?.scorePct}%{c.test?.decision === 'pass' ? ' · marked passed by you' : ''}</span></div>
            <div className="row">
              <input type="datetime-local" aria-label={`Interview time for ${name(c)}`} value={slotFor(c, i)} onChange={(e) => setSlotInputs((p) => ({ ...p, [c.id]: e.target.value }))} style={{ width: 'auto' }} />
              {ai.aiOn && <button type="button" className="btn btn--sm" onClick={() => setGuideFor(c.id)}>Interview guide</button>}
              <button type="button" className="btn btn--sm btn--primary" disabled={Boolean(busy)} onClick={() => void doBook([c])}>Book &amp; invite</button>
            </div>
          </div>
        ))}
      </section>

      <section className="card stack">
        <h2>Video interviews booked ({booked.length})</h2>
        {booked.length === 0 && <p className="muted small">None yet. The join button on the candidate&apos;s page opens 15 minutes before the start.</p>}
        {[...booked].sort((a, b) => a.interview!.startsAt - b.interview!.startsAt).map((c) => {
          const iv = c.interview!;
          const job = db.jobs.find((j) => j.id === c.jobId)!;
          return (
            <div key={c.id} className="row row--between" style={{ borderTop: '1px solid var(--line)', paddingTop: 10 }}>
              <div><strong>{name(c)}</strong> <span className="small muted">· {when(iv.startsAt)} · {iv.durationMin} min</span>
                {iv.delivery !== 'sent' && <div className="small" style={{ color: 'var(--warn)' }}>{iv.delivery === 'failed' ? `Email failed: ${iv.deliveryError}` : 'Invitation not emailed automatically — send the draft.'}</div>}</div>
              <div className="row">
                {iv.delivery !== 'sent' && <a className="btn btn--sm" href={mailto('interview', c, job, iv.link, s.companyName, { startsAt: iv.startsAt, durationMin: iv.durationMin })}>Open email draft</a>}
                <button type="button" className="btn btn--sm btn--primary" onClick={() => void openRoom(c)}>Open room</button>
                <button type="button" className="btn btn--sm" onClick={() => copy(iv.link)}>Copy link</button>
                <button type="button" className="btn btn--sm" onClick={() => patchCand(c.id, (x) => ({ ...x, interview: x.interview && { ...x.interview, status: 'completed' } }))}>Mark done</button>
                <button type="button" className="btn btn--sm btn--danger" onClick={() => confirm(`Cancel the interview with ${name(c)}? They are not notified automatically.`) && void cancelInterview(ai.api, c)}>Cancel</button>
              </div>
            </div>
          );
        })}
      </section>

      <section className="card stack">
        <h2>Activity</h2>
        {db.log.length === 0 && <p className="muted small">Nothing yet.</p>}
        {db.log.slice(-15).reverse().map((e) => (
          <div key={e.id} className="small row" style={{ alignItems: 'baseline' }}>
            <span className="faint mono" style={{ minWidth: 130 }}>{when(e.at)}</span>
            <Badge tone={e.by === 'agent' ? 'info' : 'neutral'}>{e.by}</Badge>
            <span className={e.kind === 'error' ? '' : 'muted'} style={e.kind === 'error' ? { color: 'var(--bad)' } : undefined}>{e.text}</span>
          </div>
        ))}
      </section>

      {jobWithBuilder && <TestBuilder job={jobWithBuilder} onClose={() => setBuilderJob(null)} />}
      {reviewCand?.test && <ReviewModal cand={reviewCand} onClose={() => setReview(null)} />}
      {guideCand && guideJob && <GuideModal cand={guideCand} job={guideJob} onClose={() => setGuideFor(null)} />}
    </div>
  );
}

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type Q = { id: string; type: 'mcq' | 'short'; prompt: string; options?: string[]; points: number };
type Test = {
  status: 'open' | 'started' | 'submitted' | 'expired';
  jobTitle: string;
  candidateName?: string;
  title?: string;
  instructions?: string;
  timeLimitMin?: number;
  remainingSeconds?: number | null;
  questions?: Q[];
};

const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

export default function TakeTest({ params }: { params: { id: string } }) {
  const { id } = params;
  const storeKey = `ta-test-${id}`;
  const [test, setTest] = useState<Test | null>(null);
  const [error, setError] = useState('');
  const [answers, setAnswers] = useState<Record<string, string | number>>({});
  const [endAt, setEndAt] = useState<number | null>(null);
  const [left, setLeft] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const submitted = useRef(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/public/test/${id}`, { cache: 'no-store' });
        const j = (await res.json()) as Test & { error?: string };
        if (!res.ok) return setError(j.error || 'This link is not valid.');
        setTest(j);
        if (j.status === 'started' && typeof j.remainingSeconds === 'number') setEndAt(Date.now() + j.remainingSeconds * 1000);
        try {
          const saved = window.sessionStorage.getItem(storeKey);
          if (saved) setAnswers(JSON.parse(saved));
        } catch {
          /* ignore */
        }
      } catch {
        setError('Could not load the test. Check your connection and refresh.');
      }
    })();
  }, [id, storeKey]);

  const submit = useCallback(
    async (auto = false) => {
      if (submitted.current || !test) return;
      submitted.current = true;
      setBusy(true);
      try {
        const list = (test.questions ?? []).map((q) => ({ questionId: q.id, value: answers[q.id] ?? '' }));
        const res = await fetch(`/api/public/test/${id}/submit`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ answers: list }) });
        if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error || 'Could not submit.');
        try {
          window.sessionStorage.removeItem(storeKey);
        } catch {
          /* ignore */
        }
        setDone(true);
      } catch (e) {
        submitted.current = false;
        setError((e instanceof Error ? e.message : 'Could not submit.') + (auto ? ' Your time is up — please press Submit again.' : ''));
      }
      setBusy(false);
    },
    [answers, id, storeKey, test],
  );

  // countdown, driven by the server's clock at the moment the page loaded
  useEffect(() => {
    if (endAt === null || done) return;
    const tick = () => {
      const s = Math.max(0, Math.round((endAt - Date.now()) / 1000));
      setLeft(s);
      if (s === 0) void submit(true);
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [endAt, done, submit]);

  const setAnswer = (qid: string, v: string | number) =>
    setAnswers((prev) => {
      const next = { ...prev, [qid]: v };
      try {
        window.sessionStorage.setItem(storeKey, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });

  const start = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/api/public/test/${id}/start`, { method: 'POST' });
      const j = (await res.json()) as { remainingSeconds?: number; error?: string };
      if (!res.ok) throw new Error(j.error || 'Could not start.');
      setTest((t) => (t ? { ...t, status: 'started' } : t));
      setEndAt(Date.now() + (j.remainingSeconds ?? 0) * 1000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start.');
    }
    setBusy(false);
  };

  if (error && !test) return <div className="card"><h1>Link problem</h1><p className="muted" style={{ marginTop: 8 }}>{error}</p></div>;
  if (!test) return <p className="muted">Loading…</p>;

  if (done || test.status === 'submitted') {
    return (
      <div className="card stack">
        <h1>Thank you{test.candidateName ? `, ${test.candidateName}` : ''}!</h1>
        <p>Your answers for <strong>{test.jobTitle}</strong> have been submitted. We will be in touch about the next steps. You can close this page.</p>
      </div>
    );
  }
  if (test.status === 'expired') return <div className="card"><h1>This link has expired</h1><p className="muted" style={{ marginTop: 8 }}>Please reply to the email you received and we will send a new one.</p></div>;

  if (test.status === 'open') {
    return (
      <div className="card stack">
        <p className="small muted">{test.jobTitle}</p>
        <h1>{test.title}</h1>
        {test.candidateName && <p>Hi {test.candidateName},</p>}
        <p style={{ whiteSpace: 'pre-wrap' }}>{test.instructions}</p>
        <ul className="small" style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <li>You will have <strong>{test.timeLimitMin} minutes</strong> once you press Start. The timer keeps running if you close the page.</li>
          <li>{test.questions?.length} questions. You can change answers until you submit.</li>
          <li>Please complete it on your own. Need extra time or another format? Reply to the email before you start.</li>
        </ul>
        {error && <p role="alert" style={{ color: 'var(--bad)' }}>{error}</p>}
        <div><button type="button" className="btn btn--primary" onClick={start} disabled={busy}>{busy ? 'Starting…' : 'Start the test'}</button></div>
      </div>
    );
  }

  const warn = left !== null && left <= 300;
  return (
    <div className="stack">
      <div className="card row row--between" style={{ position: 'sticky', top: 64, zIndex: 20 }}>
        <strong>{test.title}</strong>
        <span className="mono" style={{ fontWeight: 700, color: warn ? 'var(--bad)' : undefined }} aria-live={left !== null && (left === 300 || left === 60) ? 'assertive' : 'off'}>
          {left === null ? '' : `Time left ${fmt(left)}`}
        </span>
      </div>

      {(test.questions ?? []).map((q, i) => (
        <fieldset key={q.id} className="card stack" style={{ margin: 0 }}>
          <legend className="sr-only">Question {i + 1}</legend>
          <p><strong>{i + 1}.</strong> {q.prompt}</p>
          {q.type === 'mcq' ? (
            <div className="stack" style={{ gap: 8 }}>
              {(q.options ?? []).map((o, k) => (
                <label key={k} className="row" style={{ alignItems: 'flex-start' }}>
                  <input type="radio" name={q.id} checked={answers[q.id] === k} onChange={() => setAnswer(q.id, k)} style={{ marginTop: 5 }} />
                  <span>{o}</span>
                </label>
              ))}
            </div>
          ) : (
            <textarea aria-label={`Answer to question ${i + 1}`} value={String(answers[q.id] ?? '')} onChange={(e) => setAnswer(q.id, e.target.value)} maxLength={4000} style={{ minHeight: 140 }} placeholder="Type your answer here" />
          )}
        </fieldset>
      ))}

      {error && <p role="alert" style={{ color: 'var(--bad)' }}>{error}</p>}
      <div className="row">
        <button type="button" className="btn btn--primary" onClick={() => confirm('Submit your answers now? You cannot change them afterwards.') && void submit()} disabled={busy}>{busy ? 'Submitting…' : 'Submit answers'}</button>
        <span className="small faint">Answers are saved on this device as you type.</span>
      </div>
    </div>
  );
}

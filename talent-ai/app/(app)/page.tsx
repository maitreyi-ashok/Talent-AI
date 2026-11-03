'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { useDB } from '@/lib/store';
import { calibration } from '@/lib/insights';
import { addSampleData } from '@/lib/sample';
import { useAI } from '@/lib/ai-client';
import { Notice } from '@/components/ui';

export default function Overview() {
  const db = useDB();
  const ai = useAI();
  const cal = useMemo(() => calibration(db.candidates), [db.candidates]);
  const screened = db.candidates.filter((c) => c.screening).length;

  const next = !db.jobs.length
    ? { text: 'Create your first job and list its must-have skills.', href: '/hiring', cta: 'Create a job' }
    : !db.candidates.length
      ? { text: 'Add a handful of resumes to your job — start small.', href: '/hiring', cta: 'Add resumes' }
      : screened < db.candidates.length
        ? { text: 'Some resumes are not screened yet.', href: '/hiring', cta: 'Open hiring' }
        : cal.decided < 5
          ? { text: 'Move a few candidates to Interview or Declined. That is how the tool learns how well it agrees with you.', href: '/hiring', cta: 'Review candidates' }
          : !db.employees.length
            ? { text: 'Next phase: add a role profile and your people to see skill gaps.', href: '/skills', cta: 'Open skills' }
            : { text: 'Keep going — check the agreement figures below after each hiring round.', href: '/hiring', cta: 'Open hiring' };

  const phases = [
    { n: 1, title: 'Screen and organise resumes', live: true, text: 'AI (or transparent rules) does the first read: ranks candidates against your must-haves, shows its evidence, and suggests interview questions. Humans decide every stage.', href: '/hiring' },
    { n: 2, title: 'Find skill gaps', live: true, text: 'Define what each role needs, rate your people, and see where the team is short. Get a learning plan per person.', href: '/skills' },
    { n: 3, title: 'Spot retention signals', live: true, text: 'A simple, explainable checklist (engagement, 1:1s, time since promotion, workload, pay vs band) to start supportive conversations early.', href: '/retention' },
    { n: 4, title: 'HR hiring agent: tests and video interviews', live: true, text: 'Candidates who match 7/10 or better get a skills test; those who pass get a video interview. The agent proposes and sends — you stay in control of every decision.', href: '/agent' },
    { n: 5, title: 'Automate more — only once 1–4 prove useful', live: false, text: 'Rejection notes, ATS integration and async video answers. Add them one at a time, based on what the results below tell you.', href: '' },
  ];

  return (
    <div className="stack stack--lg">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <h1>Make hiring faster, find skill gaps, keep your people</h1>
          <p>Start with something achievable, learn from the results, and improve gradually. AI recommends — your team decides.</p>
        </div>
      </div>

      {ai.status && !ai.aiOn && (
        <Notice tone="info">
          Running in rules mode (no AI key configured). Everything works; AI adds deeper resume reading and test generation. <Link href="/settings">See how to turn it on</Link>.
        </Notice>
      )}

      <div className="grid grid--4">
        <div className="card"><div className="stat__value">{db.jobs.length}</div><div className="stat__label">Open jobs</div></div>
        <div className="card"><div className="stat__value">{screened}<span className="muted" style={{ fontSize: '1rem' }}> / {db.candidates.length}</span></div><div className="stat__label">Resumes screened</div></div>
        <div className="card"><div className="stat__value">{db.roles.length}</div><div className="stat__label">Role profiles</div></div>
        <div className="card"><div className="stat__value">{db.employees.length}</div><div className="stat__label">People tracked</div></div>
      </div>

      <div className="card row row--between">
        <div>
          <strong>Next best step</strong>
          <p className="muted">{next.text}</p>
        </div>
        <Link href={next.href} className="btn btn--primary">{next.cta}</Link>
      </div>

      <section className="stack">
        <h2>Roadmap</h2>
        <div className="grid grid--2">
          {phases.map((p) => (
            <div key={p.n} className="card phase">
              <div className={`phase__num${p.live ? ' phase__num--live' : ''}`}>{p.n}</div>
              <div className="stack" style={{ gap: 6 }}>
                <strong>{p.title}</strong>
                <p className="muted small">{p.text}</p>
                {p.href && <Link href={p.href} className="small">Open →</Link>}
                {!p.live && <span className="small faint">Planned</span>}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="stack">
        <h2>Learning from results</h2>
        <div className="card stack">
          {cal.decided === 0 ? (
            <p className="muted">No human decisions recorded yet. When you move screened candidates to Interview/Offer/Hired or Declined, this compares your decisions with the recommendations.</p>
          ) : (
            <>
              <div className="grid grid--4">
                <div><div className="stat__value">{cal.agreementPct}%</div><div className="stat__label">Agreement with recommendations ({cal.agree} of {cal.decided})</div></div>
                <div><div className="stat__value">{cal.humanOverrides}</div><div className="stat__label">Times you overruled it</div></div>
                <div><div className="stat__value">{cal.avgScoreAdvanced ?? '—'}</div><div className="stat__label">Avg score of people you advanced</div></div>
                <div><div className="stat__value">{cal.avgScoreDeclined ?? '—'}</div><div className="stat__label">Avg score of people you declined</div></div>
              </div>
              <p className="muted small">
                {cal.decided < 10
                  ? 'Too few decisions to draw conclusions yet — keep going.'
                  : (cal.agreementPct ?? 0) >= 75
                    ? 'The recommendations line up with your team’s judgement. Consider screening more roles this way.'
                    : 'Agreement is lower than expected. Review the must-have skills on the job — they are the main thing the screening follows — and read a few overruled cases for patterns.'}
              </p>
            </>
          )}
        </div>
      </section>

      {!db.jobs.length && !db.employees.length && (
        <p className="small muted">
          Want to look around first? <button type="button" className="btn btn--sm" onClick={addSampleData}>Load fictional sample data</button> (removable in Settings).
        </p>
      )}
    </div>
  );
}

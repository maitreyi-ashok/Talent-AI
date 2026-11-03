'use client';

import { useRef, useState, type ReactNode } from 'react';
import { EMPTY_DB, replaceDB, update, useDB } from '@/lib/store';
import { addSampleData, removeSampleData } from '@/lib/sample';
import { useAI } from '@/lib/ai-client';
import { download } from '@/lib/csv';
import { Notice } from '@/components/ui';

const Row = ({ ok, name, children }: { ok: boolean; name: string; children: ReactNode }) => (
  <li>
    <span className={`dot dot--${ok ? 'on' : 'off'}`} aria-hidden="true" /> <strong>{name}</strong> — {ok ? 'ready' : 'not set up'}. <span className="muted">{children}</span>
  </li>
);

export default function Settings() {
  const db = useDB();
  const ai = useAI();
  const st = ai.status;
  const [msg, setMsg] = useState<{ tone: 'good' | 'bad' | 'info'; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const hasSample = [...db.jobs, ...db.candidates, ...db.roles, ...db.employees].some((x) => x.sample);

  const importFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      const parsed = JSON.parse(await f.text());
      if (!confirm('Importing replaces everything currently in the database. Continue?')) return;
      replaceDB(parsed);
      setMsg({ tone: 'good', text: 'Data imported.' });
    } catch {
      setMsg({ tone: 'bad', text: 'That file is not valid Talent AI data.' });
    }
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <div className="stack stack--lg">
      <div className="page-head" style={{ marginBottom: 0 }}><div><h1>Settings</h1><p>What is connected, your data, and how this tool is built.</p></div></div>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}

      <section className="card stack">
        <h2>Connections</h2>
        {st && (
          <ul className="stack small" style={{ margin: 0, paddingLeft: 0, listStyle: 'none', gap: 10 }}>
            <Row ok={st.dbReady} name="Database (Postgres)">All jobs, candidates, employees, tests and interviews are stored here. Required.</Row>
            <Row ok={st.passcodeSet || st.openAccess} name="Team passcode"><code>APP_PASSCODE</code> — protects the workspace. Required.</Row>
            <Row ok={st.aiAvailable} name={`AI (${st.model})`}><code>ANTHROPIC_API_KEY</code> — deeper resume reading, test generation, grading of written answers. Optional; rules mode works without it.</Row>
            <Row ok={st.mailReady} name="Email"><code>RESEND_API_KEY</code> + <code>MAIL_FROM</code> — lets the agent email test and interview invitations. Optional; otherwise you get ready-to-send drafts.</Row>
            <Row ok={st.videoProvider === 'daily'} name={`Video interviews (${st.videoProvider === 'daily' ? 'Daily' : 'Jitsi link'})`}>
              {st.videoProvider === 'daily' ? 'Rooms are created per interview and only open around the scheduled time.' : <>Using a plain Jitsi link. For reliable private rooms add <code>DAILY_API_KEY</code>, or point <code>JITSI_DOMAIN</code> at your own Jitsi.</>}
            </Row>
          </ul>
        )}
      </section>

      <section className="card stack">
        <h2>Your data</h2>
        <p className="muted small">Everything is stored in your team&apos;s Postgres database and shared by everyone who signs in. Candidate resumes and test answers are personal data: keep access limited, tell candidates how their data is used, and delete what you no longer need. Test and interview records that candidates open are removed after 60 days.</p>
        <div className="row">
          <button type="button" className="btn" onClick={() => download('talent-ai-backup.json', JSON.stringify(db, null, 2), 'application/json')}>Export backup (JSON)</button>
          <button type="button" className="btn" onClick={() => fileRef.current?.click()}>Import backup…</button>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => void importFile(e.target.files?.[0])} />
        </div>
        <div className="row">
          {hasSample ? (
            <button type="button" className="btn" onClick={removeSampleData}>Remove sample data</button>
          ) : (
            <button type="button" className="btn" onClick={addSampleData}>Add fictional sample data</button>
          )}
          <button
            type="button"
            className="btn btn--danger"
            onClick={() => confirm('Delete ALL jobs, candidates, employees and settings from the database? This cannot be undone.') && update(() => EMPTY_DB)}
          >
            Delete everything
          </button>
        </div>
      </section>

      <section className="card stack">
        <h2>How it works — and its limits</h2>
        <ul className="small" style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <li><strong>AI recommends, people decide.</strong> Nothing is rejected automatically. The agent can send a test or an interview invitation, but it never declines anyone, and anything involving written answers is checked by a person.</li>
          <li><strong>Job-related evidence only.</strong> Screening ignores names, gender, age, nationality, photos and school prestige, and cites evidence from the resume. “Blind review” hides names and emails while you read.</li>
          <li><strong>Tests are not proctored.</strong> A timer limits each attempt, but you cannot be sure who took the test or whether they used help. Treat results as one signal and use the interview to confirm.</li>
          <li><strong>It can still be wrong or biased.</strong> Check the “Learning from results” panel to see how often your team agrees, and review the must-haves when it drifts.</li>
          <li><strong>Check local rules.</strong> Automated tools in hiring and employee monitoring are regulated in many places (for example the EU AI Act and some US states and cities). Get HR/legal advice and tell candidates when AI or automated steps are used.</li>
          <li><strong>Retention and skills tools are simple checklists,</strong> not predictions, and must not drive pay, promotion or disciplinary decisions.</li>
        </ul>
      </section>
    </div>
  );
}

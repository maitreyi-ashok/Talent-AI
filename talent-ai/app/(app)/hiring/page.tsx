'use client';

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { update, uid, useDB } from '@/lib/store';
import { screenWithRules } from '@/lib/screening';
import { useAI } from '@/lib/ai-client';
import { addSampleData } from '@/lib/sample';
import { download, toCSV } from '@/lib/csv';
import { REC_LABEL, STAGES, STAGE_LABEL } from '@/lib/types';
import type { Candidate, Job, Profile, ScreeningResult, Stage } from '@/lib/types';
import { Badge, Empty, Field, Modal, Notice, ScoreBar, TagInput } from '@/components/ui';

const recTone = (r: ScreeningResult['recommendation']) => (r === 'advance' ? 'good' : r === 'review' ? 'warn' : 'bad');
const stageTone = (s: Stage) => (s === 'hired' || s === 'offer' ? 'good' : s === 'interview' || s === 'test' ? 'info' : s === 'declined' ? 'bad' : 'neutral');

const mergeProfile = (a: Profile, b: Profile): Profile => ({
  name: b.name || a.name,
  email: b.email || a.email,
  headline: b.headline || a.headline,
  yearsExperience: b.yearsExperience ?? a.yearsExperience,
  skills: b.skills.length ? b.skills : a.skills,
  education: b.education.length ? b.education : a.education,
});

const toBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(new Error('Could not read the file'));
    r.readAsDataURL(file);
  });

/* ============================== Job form ============================== */

function JobForm({ initial, onClose, onSaved }: { initial?: Job; onClose: () => void; onSaved: (id: string) => void }) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [department, setDepartment] = useState(initial?.department ?? '');
  const [location, setLocation] = useState(initial?.location ?? '');
  const [minYears, setMinYears] = useState(String(initial?.minYears ?? 0));
  const [mustHave, setMustHave] = useState<string[]>(initial?.mustHave ?? []);
  const [niceToHave, setNiceToHave] = useState<string[]>(initial?.niceToHave ?? []);
  const [description, setDescription] = useState(initial?.description ?? '');

  const save = () => {
    if (!title.trim()) return;
    const id = initial?.id ?? uid();
    const job: Job = {
      id,
      title: title.trim(),
      department: department.trim(),
      location: location.trim(),
      description: description.trim(),
      mustHave,
      niceToHave,
      minYears: Math.max(0, Number(minYears) || 0),
      createdAt: initial?.createdAt ?? Date.now(),
      sample: initial?.sample,
    };
    update((db) => ({ ...db, jobs: initial ? db.jobs.map((j) => (j.id === id ? job : j)) : [...db.jobs, job] }));
    onSaved(id);
    onClose();
  };

  return (
    <Modal title={initial ? 'Edit job' : 'New job'} onClose={onClose}>
      <div className="form-grid">
        <div className="span-2">
          <Field label="Job title">
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Customer Success Analyst" autoFocus />
          </Field>
        </div>
        <Field label="Department">
          <input type="text" value={department} onChange={(e) => setDepartment(e.target.value)} />
        </Field>
        <Field label="Location">
          <input type="text" value={location} onChange={(e) => setLocation(e.target.value)} />
        </Field>
        <div className="span-2">
          <Field label="Must-have skills" hint="Type a skill and press Enter or comma. These drive the screening.">
            <TagInput value={mustHave} onChange={setMustHave} placeholder="SQL, Excel, communication…" />
          </Field>
        </div>
        <div className="span-2">
          <Field label="Nice-to-have skills">
            <TagInput value={niceToHave} onChange={setNiceToHave} placeholder="Tableau, Salesforce…" />
          </Field>
        </div>
        <Field label="Minimum years of relevant experience">
          <input type="number" min={0} max={40} value={minYears} onChange={(e) => setMinYears(e.target.value)} />
        </Field>
        <div className="span-2">
          <Field label="Description (optional)" hint="AI screening reads this for context. Rule-based screening only uses the skills above.">
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
        </div>
      </div>
      <div className="modal__foot">
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn--primary" onClick={save} disabled={!title.trim()}>Save job</button>
      </div>
    </Modal>
  );
}

/* ============================== Add resumes ============================== */

type NewItem = { fileName: string; text: string; pdf?: string };

function AddResumes({ job, onClose, onSubmit }: { job: Job; onClose: () => void; onSubmit: (items: NewItem[], auto: boolean) => void }) {
  const ai = useAI();
  const [tab, setTab] = useState<'files' | 'paste'>('files');
  const [items, setItems] = useState<NewItem[]>([]);
  const [problems, setProblems] = useState<string[]>([]);
  const [pasted, setPasted] = useState('');
  const [auto, setAuto] = useState(true);

  const onFiles = async (files: FileList | null) => {
    if (!files) return;
    const next: NewItem[] = [];
    const bad: string[] = [];
    for (const f of Array.from(files)) {
      const lower = f.name.toLowerCase();
      try {
        if (lower.endsWith('.pdf')) {
          if (!ai.aiOn) bad.push(`${f.name}: PDFs need AI. Add an AI key (see Settings), or paste the text instead.`);
          else if (f.size > 3 * 1024 * 1024) bad.push(`${f.name}: larger than 3 MB.`);
          else next.push({ fileName: f.name, text: '', pdf: await toBase64(f) });
        } else if (lower.endsWith('.txt') || lower.endsWith('.md') || f.type.startsWith('text/')) {
          if (f.size > 300 * 1024) bad.push(`${f.name}: larger than 300 KB.`);
          else next.push({ fileName: f.name, text: await f.text() });
        } else bad.push(`${f.name}: unsupported type (use .txt, .md or .pdf).`);
      } catch {
        bad.push(`${f.name}: could not be read.`);
      }
    }
    setItems((prev) => [...prev, ...next]);
    setProblems(bad);
  };

  const addPasted = () => {
    if (pasted.trim().length < 30) return;
    setItems((prev) => [...prev, { fileName: `pasted-${prev.length + 1}.txt`, text: pasted.trim() }]);
    setPasted('');
  };

  return (
    <Modal title={`Add resumes — ${job.title}`} onClose={onClose}>
      <div className="seg" role="group" aria-label="How to add">
        <button type="button" aria-pressed={tab === 'files'} onClick={() => setTab('files')}>Upload files</button>
        <button type="button" aria-pressed={tab === 'paste'} onClick={() => setTab('paste')}>Paste text</button>
      </div>

      {tab === 'files' ? (
        <div className="dropzone">
          <p>Choose one or more resumes (.txt, .md{ai.aiOn ? ', .pdf' : ''}).</p>
          <p className="small faint">{ai.aiOn ? 'PDFs are read by AI and never stored.' : 'PDF upload is available once an AI key is configured (Settings).'}</p>
          <input type="file" multiple accept={ai.aiOn ? '.txt,.md,.pdf,text/plain' : '.txt,.md,text/plain'} onChange={(e) => onFiles(e.target.files)} style={{ marginTop: 12 }} />
        </div>
      ) : (
        <div className="stack">
          <Field label="Resume text">
            <textarea value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="Paste a resume here…" style={{ minHeight: 160 }} />
          </Field>
          <div>
            <button type="button" className="btn" onClick={addPasted} disabled={pasted.trim().length < 30}>Add to list</button>
          </div>
        </div>
      )}

      {problems.length > 0 && (
        <Notice tone="warn">
          {problems.map((p) => (
            <div key={p}>{p}</div>
          ))}
        </Notice>
      )}

      {items.length > 0 && (
        <div className="stack">
          <strong>{items.length} resume{items.length > 1 ? 's' : ''} ready</strong>
          <div className="chips">
            {items.map((it, i) => (
              <span key={`${it.fileName}-${i}`} className="tag">
                {it.fileName}
                <button type="button" aria-label={`Remove ${it.fileName}`} onClick={() => setItems((prev) => prev.filter((_, j) => j !== i))}>×</button>
              </span>
            ))}
          </div>
        </div>
      )}

      <label className="row small">
        <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
        Screen right after adding ({ai.aiOn ? 'AI' : 'rule-based'})
      </label>

      <div className="modal__foot">
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button
          type="button"
          className="btn btn--primary"
          disabled={!items.length}
          onClick={() => {
            onSubmit(items, auto);
            onClose();
          }}
        >
          Add {items.length || ''} resume{items.length === 1 ? '' : 's'}
        </button>
      </div>
    </Modal>
  );
}

/* ============================== Candidate detail ============================== */

function Detail({
  cand,
  job,
  blind,
  alias,
  onClose,
  onRescreen,
  busy,
}: {
  cand: Candidate;
  job: Job;
  blind: boolean;
  alias: string;
  onClose: () => void;
  onRescreen: (c: Candidate) => void;
  busy: boolean;
}) {
  const [notes, setNotes] = useState(cand.notes);
  const s = cand.screening;
  const patch = (p: Partial<Candidate>) => update((db) => ({ ...db, candidates: db.candidates.map((c) => (c.id === cand.id ? { ...c, ...p } : c)) }));
  const name = blind ? alias : cand.profile.name || cand.fileName;

  return (
    <Modal title={name} onClose={onClose} wide>
      <Notice tone="info">This is a recommendation to help you prioritise. The decision is yours — please read the resume and use your judgement.</Notice>

      <div className="row row--between">
        <div className="row">
          <Badge tone={stageTone(cand.stage)}>{STAGE_LABEL[cand.stage]}</Badge>
          {!blind && cand.profile.email && <span className="small muted">{cand.profile.email}</span>}
          {cand.profile.yearsExperience !== null && <span className="small muted">{cand.profile.yearsExperience} yrs experience</span>}
        </div>
        <div className="row">
          <label className="row small">
            Move to
            <select value={cand.stage} onChange={(e) => patch({ stage: e.target.value as Stage, stageBy: 'human' })} style={{ width: 'auto' }}>
              {STAGES.map((st) => (
                <option key={st} value={st}>{STAGE_LABEL[st]}</option>
              ))}
            </select>
          </label>
          <button type="button" className="btn btn--sm" disabled={busy || (!cand.resumeText && !s)} onClick={() => onRescreen(cand)} title={cand.resumeText ? '' : 'PDF resumes are not stored — add the file again to re-screen'}>
            {s ? 'Re-screen' : 'Screen'}
          </button>
        </div>
      </div>

      {s ? (
        <>
          <div className="card card--flat stack">
            <div className="row row--between">
              <div className="row">
                <Badge tone={recTone(s.recommendation)}>{REC_LABEL[s.recommendation]}</Badge>
                <span className="small muted">
                  {s.engine === 'ai' ? `AI (${s.model ?? 'model'})` : 'Rule-based'} · confidence {s.confidence}
                </span>
              </div>
              <div style={{ minWidth: 180 }}><ScoreBar value={s.score} /></div>
            </div>
            <p>{s.summary}</p>
            {s.flags.map((f) => (
              <Notice key={f} tone="warn">{f}</Notice>
            ))}
          </div>

          <div className="grid grid--2">
            <div className="stack">
              <h3>Matched requirements</h3>
              {s.matched.length === 0 && <p className="muted small">Nothing matched.</p>}
              {s.matched.map((m, i) => (
                <div key={`${m.requirement}-${i}`} className="evidence">
                  <strong>{m.requirement}</strong>
                  <div className="small muted">{m.evidence}</div>
                </div>
              ))}
            </div>
            <div className="stack">
              <h3>Gaps to check</h3>
              {s.gaps.length === 0 && <p className="muted small">No gaps found.</p>}
              {s.gaps.map((g, i) => (
                <div key={`${g.requirement}-${i}`} className="evidence evidence--gap">
                  <strong>{g.requirement}</strong>
                  <div className="small muted">{g.note}</div>
                </div>
              ))}
            </div>
          </div>

          {s.questions.length > 0 && (
            <div className="stack">
              <h3>Suggested interview questions</h3>
              <ul style={{ margin: 0, paddingLeft: 20 }}>
                {s.questions.map((q) => (
                  <li key={q}>{q}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      ) : (
        <Notice tone="warn">Not screened yet. Press Screen to get a recommendation for “{job.title}”.</Notice>
      )}

      {(cand.test || cand.interview) && (
        <div className="card card--flat stack">
          <h3>Hiring agent</h3>
          {cand.test && (
            <div className="small">
              <strong>Test:</strong> {cand.test.status === 'submitted' ? `submitted — ${cand.test.scorePct ?? '?'}%${cand.test.decision ? ` (you marked it: ${cand.test.decision})` : cand.test.passed ? ' (passed)' : ' (below pass mark)'}` : cand.test.status === 'started' ? 'started' : 'sent, waiting'}
              {cand.test.delivery === 'draft' && ' · email not sent automatically'}
            </div>
          )}
          {cand.interview && (
            <div className="small">
              <strong>Video interview:</strong> {new Date(cand.interview.startsAt).toLocaleString()} · {cand.interview.status}
            </div>
          )}
          <Link href="/agent" className="small">Open in the agent →</Link>
        </div>
      )}

      <Field label="Notes">
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== cand.notes && patch({ notes })} placeholder="Your own observations…" />
      </Field>

      {!blind && cand.resumeText && (
        <details>
          <summary>Original resume text</summary>
          <pre className="resume">{cand.resumeText}</pre>
        </details>
      )}

      <div className="modal__foot">
        <button
          type="button"
          className="btn btn--danger"
          onClick={() => {
            if (confirm('Delete this candidate permanently?')) {
              update((db) => ({ ...db, candidates: db.candidates.filter((c) => c.id !== cand.id) }));
              onClose();
            }
          }}
        >
          Delete
        </button>
        <button type="button" className="btn btn--primary" onClick={onClose}>Done</button>
      </div>
    </Modal>
  );
}

/* ============================== Page ============================== */

export default function HiringPage() {
  const db = useDB();
  const ai = useAI();
  const [jobId, setJobId] = useState('');
  const [jobForm, setJobForm] = useState<'new' | 'edit' | null>(null);
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [blind, setBlind] = useState(false);
  const [q, setQ] = useState('');
  const [recFilter, setRecFilter] = useState<'all' | ScreeningResult['recommendation'] | 'unscreened'>('all');
  const [stageFilter, setStageFilter] = useState<'all' | Stage>('all');
  const [sort, setSort] = useState<'score' | 'recent'>('score');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [messages, setMessages] = useState<string[]>([]);

  const job = db.jobs.find((j) => j.id === jobId) ?? db.jobs[0];
  const all = useMemo(() => (job ? db.candidates.filter((c) => c.jobId === job.id) : []), [db.candidates, job]);
  const aliasOf = useCallback((c: Candidate) => `Candidate ${String(all.findIndex((x) => x.id === c.id) + 1).padStart(2, '0')}`, [all]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all
      .filter((c) => {
        if (recFilter === 'unscreened' ? Boolean(c.screening) : recFilter !== 'all' && c.screening?.recommendation !== recFilter) return false;
        if (stageFilter !== 'all' && c.stage !== stageFilter) return false;
        if (!needle) return true;
        const hay = `${blind ? '' : `${c.profile.name} ${c.profile.email} ${c.fileName}`} ${c.profile.skills.join(' ')} ${c.profile.headline}`.toLowerCase();
        return hay.includes(needle);
      })
      .sort((a, b) => (sort === 'score' ? (b.screening?.score ?? -1) - (a.screening?.score ?? -1) : b.addedAt - a.addedAt));
  }, [all, q, recFilter, stageFilter, sort, blind]);

  const screenOne = useCallback(
    async (j: Job, cand: { id: string; resumeText: string }, pdf?: string): Promise<string | null> => {
      let out: { profile: Profile; screening: ScreeningResult } | null = null;
      let warn: string | null = null;
      if (ai.aiOn) {
        try {
          out = await ai.screen(j, cand.resumeText, pdf);
        } catch (e) {
          warn = `${e instanceof Error ? e.message : 'AI failed'} — used rule-based screening instead.`;
        }
      }
      if (!out) {
        if (!cand.resumeText) return warn ?? 'PDF resumes need AI. Add an AI key (see Settings), or paste the text instead.';
        out = screenWithRules(j, cand.resumeText);
      }
      const result = out;
      update((d) => ({
        ...d,
        candidates: d.candidates.map((c) =>
          c.id === cand.id ? { ...c, profile: mergeProfile(c.profile, result.profile), screening: result.screening, stage: c.stage === 'new' ? 'screened' : c.stage } : c,
        ),
      }));
      return warn;
    },
    [ai],
  );

  const runQueue = useCallback(
    async (j: Job, queue: { id: string; resumeText: string; pdf?: string }[]) => {
      setMessages([]);
      setProgress({ done: 0, total: queue.length });
      const notes: string[] = [];
      for (let i = 0; i < queue.length; i++) {
        const w = await screenOne(j, queue[i], queue[i].pdf);
        if (w) notes.push(w);
        setProgress({ done: i + 1, total: queue.length });
      }
      setProgress(null);
      setMessages([...new Set(notes)]);
    },
    [screenOne],
  );

  const addCandidates = (items: NewItem[], auto: boolean) => {
    if (!job) return;
    const now = Date.now();
    const fresh: Candidate[] = items.map((it, i) => ({
      id: uid(),
      jobId: job.id,
      fileName: it.fileName,
      resumeText: it.text,
      profile: { name: '', email: '', headline: '', yearsExperience: null, skills: [], education: [] },
      stage: 'new',
      notes: '',
      addedAt: now + i,
    }));
    update((d) => ({ ...d, candidates: [...d.candidates, ...fresh] }));
    if (auto) void runQueue(job, fresh.map((c, i) => ({ id: c.id, resumeText: c.resumeText, pdf: items[i].pdf })));
  };

  const screenAllNew = () => {
    if (!job) return;
    const todo = all.filter((c) => !c.screening && c.resumeText);
    if (todo.length) void runQueue(job, todo.map((c) => ({ id: c.id, resumeText: c.resumeText })));
  };

  const exportCsv = () => {
    if (!job) return;
    const rows = shown.map((c) => [
      blind ? aliasOf(c) : c.profile.name || c.fileName,
      blind ? '' : c.profile.email,
      job.title,
      c.screening?.score ?? '',
      c.screening ? REC_LABEL[c.screening.recommendation] : 'Not screened',
      STAGE_LABEL[c.stage],
      c.profile.yearsExperience ?? '',
      c.profile.skills.join('; '),
      c.screening ? (c.screening.engine === 'ai' ? 'AI' : 'Rules') : '',
    ]);
    download(`candidates-${job.title.replace(/\W+/g, '-').toLowerCase()}.csv`, toCSV(['Candidate', 'Email', 'Job', 'Score', 'Recommendation', 'Stage', 'Years', 'Skills', 'Engine'], rows));
  };

  const open = all.find((c) => c.id === openId);
  const unscreened = all.filter((c) => !c.screening && c.resumeText).length;

  if (!db.jobs.length) {
    return (
      <>
        <div className="page-head"><div><h1>Hiring</h1><p>Screen and organise resumes against a job, then decide who moves forward.</p></div></div>
        <Empty title="Start by creating your first job">
          <p>List the must-have skills. Then add resumes and get a ranked, explained shortlist in seconds.</p>
          <div className="row">
            <button type="button" className="btn btn--primary" onClick={() => setJobForm('new')}>Create a job</button>
            <button type="button" className="btn" onClick={addSampleData}>Try with fictional sample data</button>
          </div>
        </Empty>
        {jobForm && <JobForm onClose={() => setJobForm(null)} onSaved={setJobId} />}
      </>
    );
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Hiring</h1>
          <p>Phase 1: let AI do the first read — screen, rank and organise — while your team makes every decision.</p>
        </div>
        <div className="row">
          <button type="button" className="btn" onClick={() => setJobForm('new')}>New job</button>
          <button type="button" className="btn btn--primary" onClick={() => setAdding(true)} disabled={!job}>Add resumes</button>
        </div>
      </div>

      {job && (
        <div className="card stack" style={{ marginBottom: 16 }}>
          <div className="row row--between">
            <div className="row grow">
              <select aria-label="Job" value={job.id} onChange={(e) => setJobId(e.target.value)} style={{ maxWidth: 380 }}>
                {db.jobs.map((j) => (
                  <option key={j.id} value={j.id}>{j.title}</option>
                ))}
              </select>
              <button type="button" className="btn btn--sm" onClick={() => setJobForm('edit')}>Edit job</button>
              <button
                type="button"
                className="btn btn--sm btn--danger"
                onClick={() => {
                  if (confirm(`Delete “${job.title}” and its ${all.length} candidate(s) permanently?`)) {
                    update((d) => ({ ...d, jobs: d.jobs.filter((j) => j.id !== job.id), candidates: d.candidates.filter((c) => c.jobId !== job.id) }));
                    setJobId('');
                  }
                }}
              >
                Delete job
              </button>
            </div>
            <span className="small muted">{ai.aiOn ? 'AI screening is on' : 'Rule-based screening (AI is off — see Settings)'}</span>
          </div>
          <div className="chips">
            {job.mustHave.map((s) => <Badge key={s} tone="info">{s}</Badge>)}
            {job.niceToHave.map((s) => <span key={s} className="pill">{s}</span>)}
            {job.minYears > 0 && <span className="pill">{job.minYears}+ yrs</span>}
            {!job.mustHave.length && <span className="small muted">No must-have skills yet — add some so screening has something to match.</span>}
          </div>
        </div>
      )}

      {progress && <Notice tone="info">Screening {progress.done} of {progress.total}…</Notice>}
      {messages.map((m) => (
        <div key={m} style={{ marginBottom: 8 }}><Notice tone="warn">{m}</Notice></div>
      ))}

      <div className="card stack">
        <div className="row row--between">
          <div className="row grow">
            <input type="search" placeholder="Search skills or names" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 260 }} aria-label="Search candidates" />
            <select aria-label="Recommendation" value={recFilter} onChange={(e) => setRecFilter(e.target.value as typeof recFilter)} style={{ width: 'auto' }}>
              <option value="all">All recommendations</option>
              <option value="advance">Advance</option>
              <option value="review">Needs review</option>
              <option value="hold">Hold</option>
              <option value="unscreened">Not screened</option>
            </select>
            <select aria-label="Stage" value={stageFilter} onChange={(e) => setStageFilter(e.target.value as typeof stageFilter)} style={{ width: 'auto' }}>
              <option value="all">All stages</option>
              {STAGES.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
            </select>
            <select aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} style={{ width: 'auto' }}>
              <option value="score">Highest score first</option>
              <option value="recent">Newest first</option>
            </select>
          </div>
          <div className="row">
            <label className="row small" title="Hides names and emails while you review, to reduce bias">
              <input type="checkbox" checked={blind} onChange={(e) => setBlind(e.target.checked)} /> Blind review
            </label>
            {unscreened > 0 && <button type="button" className="btn btn--sm" onClick={screenAllNew} disabled={Boolean(progress)}>Screen {unscreened} new</button>}
            <button type="button" className="btn btn--sm" onClick={exportCsv} disabled={!shown.length}>Export CSV</button>
          </div>
        </div>

        <div className="list" style={{ marginTop: 4 }}>
          {all.length === 0 && (
            <Empty title="No resumes yet">
              <p>Add resumes for “{job?.title}” and they will be screened and ranked here.</p>
              <button type="button" className="btn btn--primary" onClick={() => setAdding(true)}>Add resumes</button>
            </Empty>
          )}
          {all.length > 0 && shown.length === 0 && <p className="muted" style={{ padding: 16 }}>No candidates match these filters.</p>}
          {shown.map((c) => (
            <div
              key={c.id}
              className="item"
              role="button"
              tabIndex={0}
              onClick={() => setOpenId(c.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setOpenId(c.id);
                }
              }}
              aria-label={`Open ${blind ? aliasOf(c) : c.profile.name || c.fileName}`}
            >
              <div className="item__main">
                <div className="item__name">{blind ? aliasOf(c) : c.profile.name || c.fileName}</div>
                <div className="item__sub">
                  {[!blind && c.profile.headline, c.profile.yearsExperience !== null && `${c.profile.yearsExperience} yrs`].filter(Boolean).join(' · ') || (c.screening ? 'Screened' : 'Not screened yet')}
                </div>
                {c.profile.skills.length > 0 && (
                  <div className="chips" style={{ marginTop: 6 }}>
                    {c.profile.skills.slice(0, 5).map((s) => <span key={s} className="pill">{s}</span>)}
                  </div>
                )}
              </div>
              <div className="item__score">{c.screening ? <ScoreBar value={c.screening.score} /> : <span className="small faint">—</span>}</div>
              <div>{c.screening ? <Badge tone={recTone(c.screening.recommendation)}>{REC_LABEL[c.screening.recommendation]}</Badge> : <Badge>Unscreened</Badge>}</div>
              <div><Badge tone={stageTone(c.stage)}>{STAGE_LABEL[c.stage]}</Badge></div>
            </div>
          ))}
        </div>
      </div>

      <p className="small faint" style={{ marginTop: 16 }}>
        Recommendations are suggestions based on the skills you listed. They can be wrong or biased — always review the resume. See{' '}
        <Link href="/settings">how this is built</Link>.
      </p>

      {jobForm && <JobForm initial={jobForm === 'edit' ? job : undefined} onClose={() => setJobForm(null)} onSaved={setJobId} />}
      {adding && job && <AddResumes job={job} onClose={() => setAdding(false)} onSubmit={addCandidates} />}
      {open && job && (
        <Detail
          cand={open}
          job={job}
          blind={blind}
          alias={aliasOf(open)}
          busy={Boolean(progress)}
          onClose={() => setOpenId(null)}
          onRescreen={(c) => void runQueue(job, [{ id: c.id, resumeText: c.resumeText }])}
        />
      )}
    </>
  );
}

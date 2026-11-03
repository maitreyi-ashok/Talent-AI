'use client';

import { useMemo, useState } from 'react';
import { update, uid, useDB } from '@/lib/store';
import { employeeGaps, readiness, teamSummary, templatePlan } from '@/lib/skills';
import type { Gap, LearningPlan } from '@/lib/skills';
import { useAI } from '@/lib/ai-client';
import { addSampleData } from '@/lib/sample';
import type { Employee, RoleProfile } from '@/lib/types';
import EmployeeForm from '@/components/EmployeeForm';
import { Badge, Empty, Field, Modal, Notice, ScoreBar } from '@/components/ui';

function Level({ current, target }: { current: number; target: number }) {
  return (
    <span className="level" role="img" aria-label={`Level ${current} of target ${target}`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <i key={n} className={n <= current ? 'on' : n <= target ? 'gap' : ''} />
      ))}
    </span>
  );
}

function RoleForm({ initial, onClose }: { initial?: RoleProfile; onClose: () => void }) {
  const [name, setName] = useState(initial?.name ?? '');
  const [reqs, setReqs] = useState(initial?.requirements.length ? initial.requirements : [{ skill: '', target: 3 }]);

  const save = () => {
    const clean = reqs.map((r) => ({ skill: r.skill.trim(), target: r.target })).filter((r) => r.skill);
    if (!name.trim() || !clean.length) return;
    const role: RoleProfile = { id: initial?.id ?? uid(), name: name.trim(), requirements: clean, sample: initial?.sample };
    update((d) => ({ ...d, roles: initial ? d.roles.map((r) => (r.id === role.id ? role : r)) : [...d.roles, role] }));
    onClose();
  };

  return (
    <Modal title={initial ? 'Edit role profile' : 'New role profile'} onClose={onClose}>
      <Field label="Role name">
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Data Analyst" autoFocus />
      </Field>
      <div className="stack">
        <h3>Skills this role needs, and the target level (1–5)</h3>
        {reqs.map((r, i) => (
          <div key={i} className="row">
            <input type="text" aria-label="Skill" className="grow" value={r.skill} placeholder="Skill" onChange={(e) => setReqs(reqs.map((x, j) => (j === i ? { ...x, skill: e.target.value } : x)))} />
            <select aria-label="Target level" style={{ width: 90 }} value={r.target} onChange={(e) => setReqs(reqs.map((x, j) => (j === i ? { ...x, target: Number(e.target.value) } : x)))}>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
            <button type="button" className="btn btn--ghost btn--icon" aria-label="Remove skill" onClick={() => setReqs(reqs.filter((_, j) => j !== i))} disabled={reqs.length === 1}>✕</button>
          </div>
        ))}
        <div>
          <button type="button" className="btn btn--sm" onClick={() => setReqs([...reqs, { skill: '', target: 3 }])}>Add skill</button>
        </div>
      </div>
      <div className="modal__foot">
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn--primary" onClick={save} disabled={!name.trim() || !reqs.some((r) => r.skill.trim())}>Save role</button>
      </div>
    </Modal>
  );
}

function PlanModal({ emp, role, gaps, onClose }: { emp: Employee; role: RoleProfile; gaps: Gap[]; onClose: () => void }) {
  const ai = useAI();
  const [plan, setPlan] = useState<LearningPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  const make = async () => {
    setBusy(true);
    setNote('');
    const open = gaps.filter((g) => g.gap > 0);
    if (ai.aiOn && open.length) {
      try {
        setPlan(await ai.plan(role.name, open));
        setBusy(false);
        return;
      } catch (e) {
        setNote(`${e instanceof Error ? e.message : 'AI failed'} — showing the simple plan instead.`);
      }
    }
    setPlan(templatePlan(gaps));
    setBusy(false);
  };

  return (
    <Modal title={`Learning plan — ${emp.name}`} onClose={onClose}>
      <p className="muted small">{ai.aiOn ? 'AI drafts the plan from skills and levels only — the employee’s name is never sent.' : 'AI is off, so this uses a simple template. Add an AI key (Settings) for a tailored plan.'}</p>
      {!plan && (
        <div>
          <button type="button" className="btn btn--primary" onClick={make} disabled={busy}>{busy ? 'Creating…' : 'Create plan'}</button>
        </div>
      )}
      {note && <Notice tone="warn">{note}</Notice>}
      {plan && (
        <div className="stack">
          <Badge tone={plan.engine === 'ai' ? 'info' : 'neutral'}>{plan.engine === 'ai' ? 'AI-drafted' : 'Template'}</Badge>
          <p>{plan.summary}</p>
          {plan.steps.map((s) => (
            <div key={s.skill} className="evidence">
              <strong>{s.skill}</strong> <span className="small muted">· {s.timeframe}</span>
              <div className="small">{s.action}</div>
            </div>
          ))}
          {plan.steps.length === 0 && <p className="muted">No gaps against this role profile.</p>}
        </div>
      )}
      <div className="modal__foot"><button type="button" className="btn" onClick={onClose}>Close</button></div>
    </Modal>
  );
}

export default function SkillsPage() {
  const db = useDB();
  const [roleForm, setRoleForm] = useState<RoleProfile | 'new' | null>(null);
  const [empForm, setEmpForm] = useState<Employee | 'new' | null>(null);
  const [planFor, setPlanFor] = useState<string | null>(null);

  const rows = useMemo(
    () =>
      db.employees.map((e) => {
        const role = db.roles.find((r) => r.id === e.roleId);
        const gaps = employeeGaps(e, role);
        return { e, role, gaps, ready: readiness(gaps) };
      }),
    [db.employees, db.roles],
  );
  const team = useMemo(() => teamSummary(db.employees, db.roles), [db.employees, db.roles]);
  const planRow = rows.find((r) => r.e.id === planFor);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Skill gaps</h1>
          <p>Phase 2: define the skills each role needs, rate your people, and see where the team is short — then plan the learning.</p>
        </div>
        <div className="row">
          <button type="button" className="btn" onClick={() => setRoleForm('new')}>New role profile</button>
          <button type="button" className="btn btn--primary" onClick={() => setEmpForm('new')}>Add employee</button>
        </div>
      </div>

      {db.roles.length === 0 && db.employees.length === 0 ? (
        <Empty title="Start with one role">
          <p>Create a role profile (the skills and target levels), then add the people in that role.</p>
          <div className="row">
            <button type="button" className="btn btn--primary" onClick={() => setRoleForm('new')}>Create a role profile</button>
            <button type="button" className="btn" onClick={addSampleData}>Try with fictional sample data</button>
          </div>
        </Empty>
      ) : (
        <div className="stack stack--lg">
          <section className="stack">
            <h2>Role profiles</h2>
            <div className="grid grid--3">
              {db.roles.map((r) => (
                <div key={r.id} className="card stack">
                  <div className="row row--between">
                    <strong>{r.name}</strong>
                    <div className="row">
                      <button type="button" className="btn btn--sm" onClick={() => setRoleForm(r)}>Edit</button>
                      <button
                        type="button"
                        className="btn btn--sm btn--danger"
                        onClick={() => {
                          if (confirm(`Delete role profile “${r.name}”? Employees keep their data but lose this role.`)) {
                            update((d) => ({ ...d, roles: d.roles.filter((x) => x.id !== r.id), employees: d.employees.map((e) => (e.roleId === r.id ? { ...e, roleId: '' } : e)) }));
                          }
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                  <div className="chips">
                    {r.requirements.map((q) => (
                      <span key={q.skill} className="pill">{q.skill} · {q.target}</span>
                    ))}
                  </div>
                </div>
              ))}
              {db.roles.length === 0 && <p className="muted">No role profiles yet.</p>}
            </div>
          </section>

          {team.length > 0 && (
            <section className="stack">
              <h2>Where the team is short</h2>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>Skill</th><th>Team average</th><th>Target</th><th>Below target</th></tr>
                  </thead>
                  <tbody>
                    {team.map((t) => (
                      <tr key={t.skill}>
                        <td><strong>{t.skill}</strong></td>
                        <td className="mono">{t.avgCurrent.toFixed(1)}</td>
                        <td className="mono">{t.avgTarget.toFixed(1)}</td>
                        <td>{t.belowTarget} of {t.total} {t.belowTarget === t.total && t.total > 1 ? <Badge tone="bad">everyone</Badge> : t.avgGap >= 1 ? <Badge tone="warn">priority</Badge> : null}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <section className="stack">
            <h2>People</h2>
            {rows.length === 0 && <p className="muted">No employees yet.</p>}
            <div className="grid grid--2">
              {rows.map(({ e, role, gaps, ready }) => (
                <div key={e.id} className="card stack">
                  <div className="row row--between">
                    <div>
                      <strong>{e.name}</strong>
                      <div className="small muted">{role?.name ?? 'No role profile'}</div>
                    </div>
                    <div className="row">
                      {role && <button type="button" className="btn btn--sm" onClick={() => setPlanFor(e.id)}>Learning plan</button>}
                      <button type="button" className="btn btn--sm" onClick={() => setEmpForm(e)}>Edit</button>
                      <button type="button" className="btn btn--sm btn--danger" onClick={() => confirm(`Delete ${e.name}?`) && update((d) => ({ ...d, employees: d.employees.filter((x) => x.id !== e.id) }))}>Delete</button>
                    </div>
                  </div>
                  {role ? (
                    <>
                      <div className="row"><span className="small muted">Role readiness</span><div style={{ minWidth: 150 }}><ScoreBar value={ready} label={`Readiness ${ready} percent`} /></div></div>
                      <div className="stack" style={{ gap: 6 }}>
                        {gaps.map((g) => (
                          <div key={g.skill} className="row row--between small">
                            <span>{g.skill}</span>
                            <span className="row"><Level current={g.current} target={g.target} />{g.gap > 0 ? <Badge tone="warn">−{g.gap}</Badge> : <Badge tone="good">met</Badge>}</span>
                          </div>
                        ))}
                      </div>
                    </>
                  ) : (
                    <p className="small muted">Assign a role profile to see skill gaps.</p>
                  )}
                </div>
              ))}
            </div>
          </section>
        </div>
      )}

      {roleForm && <RoleForm initial={roleForm === 'new' ? undefined : roleForm} onClose={() => setRoleForm(null)} />}
      {empForm && <EmployeeForm initial={empForm === 'new' ? undefined : empForm} showSignals={false} onClose={() => setEmpForm(null)} />}
      {planRow && planRow.role && <PlanModal emp={planRow.e} role={planRow.role} gaps={planRow.gaps} onClose={() => setPlanFor(null)} />}
    </>
  );
}

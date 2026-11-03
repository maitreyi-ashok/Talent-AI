'use client';

import { useMemo, useState } from 'react';
import { update, useDB } from '@/lib/store';
import { assessRisk, teamDrivers } from '@/lib/retention';
import type { Risk, RiskLevel } from '@/lib/retention';
import { addSampleData } from '@/lib/sample';
import type { Employee } from '@/lib/types';
import EmployeeForm from '@/components/EmployeeForm';
import { Badge, Empty, Modal, Notice, ScoreBar } from '@/components/ui';

const LEVEL_TONE: Record<RiskLevel, 'good' | 'warn' | 'bad' | 'neutral'> = { low: 'good', medium: 'warn', high: 'bad', unknown: 'neutral' };
const LEVEL_LABEL: Record<RiskLevel, string> = { low: 'Low', medium: 'Medium', high: 'High', unknown: 'Not enough data' };

export default function RetentionPage() {
  const db = useDB();
  const [form, setForm] = useState<Employee | 'new' | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const rows = useMemo(
    () =>
      db.employees
        .map((e) => ({ e, risk: assessRisk(e.signals) }))
        .sort((a, b) => Number(a.risk.level === 'unknown') - Number(b.risk.level === 'unknown') || b.risk.score - a.risk.score),
    [db.employees],
  );
  const counts = useMemo(() => {
    const c: Record<RiskLevel, number> = { low: 0, medium: 0, high: 0, unknown: 0 };
    rows.forEach((r) => c[r.risk.level]++);
    return c;
  }, [rows]);
  const drivers = useMemo(() => teamDrivers(db.employees).slice(0, 5), [db.employees]);
  const open = rows.find((r) => r.e.id === openId);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Retention</h1>
          <p>Phase 3: spot early warning signs so managers can have the right conversation sooner. These are signals to support people, not predictions.</p>
        </div>
        <button type="button" className="btn btn--primary" onClick={() => setForm('new')}>Add employee</button>
      </div>

      <Notice tone="warn">Use this to start supportive conversations. Do not use it for pay, promotion, discipline or dismissal decisions, and share individual results only with the people who need them.</Notice>

      {db.employees.length === 0 ? (
        <div style={{ marginTop: 16 }}>
          <Empty title="No employees yet">
            <p>Add people and the signals you already track (engagement score, 1:1s, time since promotion, overtime, pay vs band).</p>
            <div className="row">
              <button type="button" className="btn btn--primary" onClick={() => setForm('new')}>Add an employee</button>
              <button type="button" className="btn" onClick={addSampleData}>Try with fictional sample data</button>
            </div>
          </Empty>
        </div>
      ) : (
        <div className="stack stack--lg" style={{ marginTop: 16 }}>
          <div className="grid grid--4">
            {(['high', 'medium', 'low', 'unknown'] as RiskLevel[]).map((l) => (
              <div key={l} className="card">
                <div className="stat__value">{counts[l]}</div>
                <div className="stat__label">{LEVEL_LABEL[l]}{l === 'unknown' ? ' (fewer than half the signals)' : ' risk'}</div>
              </div>
            ))}
          </div>

          {drivers.length > 0 && (
            <div className="card stack">
              <h2>Most common drivers across the team</h2>
              <div className="chips">
                {drivers.map((d) => (
                  <Badge key={d.label} tone="info">{d.label} · {d.count}</Badge>
                ))}
              </div>
              <p className="small muted">Team-level patterns usually point to something fixable (workload, 1:1 habits, growth paths) more than any one person does.</p>
            </div>
          )}

          <div className="list">
            {rows.map(({ e, risk }) => (
              <div
                key={e.id}
                className="item"
                role="button"
                tabIndex={0}
                onClick={() => setOpenId(e.id)}
                onKeyDown={(ev) => {
                  if (ev.key === 'Enter' || ev.key === ' ') {
                    ev.preventDefault();
                    setOpenId(e.id);
                  }
                }}
              >
                <div className="item__main">
                  <div className="item__name">{e.name}</div>
                  <div className="item__sub">{db.roles.find((r) => r.id === e.roleId)?.name ?? 'No role profile'}</div>
                  <div className="chips" style={{ marginTop: 6 }}>
                    {risk.drivers.slice(0, 3).map((d) => (
                      <span key={d.label} className="pill">{d.label}</span>
                    ))}
                  </div>
                </div>
                <div className="item__score">{risk.level === 'unknown' ? <span className="small faint">Add more signals</span> : <ScoreBar value={risk.score} label={`Risk signals ${risk.score} of 100`} />}</div>
                <div><Badge tone={LEVEL_TONE[risk.level]}>{LEVEL_LABEL[risk.level]}</Badge></div>
                <div />
              </div>
            ))}
          </div>
        </div>
      )}

      {form && <EmployeeForm initial={form === 'new' ? undefined : form} onClose={() => setForm(null)} />}
      {open && <RiskDetail e={open.e} risk={open.risk} onClose={() => setOpenId(null)} onEdit={() => { setForm(open.e); setOpenId(null); }} />}
    </>
  );
}

function RiskDetail({ e, risk, onClose, onEdit }: { e: Employee; risk: Risk; onClose: () => void; onEdit: () => void }) {
  return (
    <Modal title={e.name} onClose={onClose}>
      <div className="row row--between">
        <Badge tone={LEVEL_TONE[risk.level]}>{LEVEL_LABEL[risk.level]}</Badge>
        <span className="small muted">{Math.round(risk.coverage * 6)} of 6 signals provided</span>
      </div>
      {risk.level === 'unknown' && <Notice tone="info">Not enough signals to say anything useful yet. Add more of the six signals.</Notice>}
      {risk.drivers.length === 0 && risk.level !== 'unknown' && <p className="muted">No warning signs in the signals provided.</p>}
      <div className="stack">
        {risk.drivers.map((d) => (
          <div key={d.label} className="evidence evidence--gap">
            <strong>{d.label}</strong> <span className="small muted">· {d.detail}</span>
            <div className="small">Suggested next step: {d.action}</div>
          </div>
        ))}
      </div>
      <p className="small muted">This is a simple rule-based checklist, not a prediction. Talk to the person before drawing any conclusion.</p>
      <div className="modal__foot">
        <button type="button" className="btn btn--danger" onClick={() => confirm(`Delete ${e.name}?`) && (update((d) => ({ ...d, employees: d.employees.filter((x) => x.id !== e.id) })), onClose())}>Delete</button>
        <button type="button" className="btn" onClick={onEdit}>Edit signals</button>
        <button type="button" className="btn btn--primary" onClick={onClose}>Done</button>
      </div>
    </Modal>
  );
}

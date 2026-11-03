'use client';

import { useState } from 'react';
import { update, uid, useDB } from '@/lib/store';
import { emptySignals, skillKey } from '@/lib/types';
import type { Employee, Signals } from '@/lib/types';
import { Field, Modal } from './ui';

const toNum = (s: string): number | null => {
  if (s.trim() === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
const toStr = (n: number | null) => (n === null ? '' : String(n));

export default function EmployeeForm({ initial, onClose, showSignals = true }: { initial?: Employee; onClose: () => void; showSignals?: boolean }) {
  const db = useDB();
  const [name, setName] = useState(initial?.name ?? '');
  const [roleId, setRoleId] = useState(initial?.roleId ?? db.roles[0]?.id ?? '');
  const [skills, setSkills] = useState<Record<string, number>>(initial?.skills ?? {});
  const s0 = initial?.signals ?? emptySignals();
  const [sig, setSig] = useState({
    tenureMonths: toStr(s0.tenureMonths),
    monthsSincePromotion: toStr(s0.monthsSincePromotion),
    engagement: toStr(s0.engagement),
    oneOnOnesPerMonth: toStr(s0.oneOnOnesPerMonth),
    overtimeHoursPerWeek: toStr(s0.overtimeHoursPerWeek),
    compaRatio: toStr(s0.compaRatio),
  });
  const role = db.roles.find((r) => r.id === roleId);

  const save = () => {
    if (!name.trim()) return;
    const signals: Signals = {
      tenureMonths: toNum(sig.tenureMonths),
      monthsSincePromotion: toNum(sig.monthsSincePromotion),
      engagement: toNum(sig.engagement),
      oneOnOnesPerMonth: toNum(sig.oneOnOnesPerMonth),
      overtimeHoursPerWeek: toNum(sig.overtimeHoursPerWeek),
      compaRatio: toNum(sig.compaRatio),
    };
    const emp: Employee = { id: initial?.id ?? uid(), name: name.trim(), roleId, skills, signals, sample: initial?.sample };
    update((d) => ({ ...d, employees: initial ? d.employees.map((e) => (e.id === emp.id ? emp : e)) : [...d.employees, emp] }));
    onClose();
  };

  const num = (key: keyof typeof sig, label: string, hint?: string, step = '1') => (
    <Field label={label} hint={hint}>
      <input type="number" step={step} value={sig[key]} onChange={(e) => setSig({ ...sig, [key]: e.target.value })} />
    </Field>
  );

  return (
    <Modal title={initial ? 'Edit employee' : 'Add employee'} onClose={onClose}>
      <div className="form-grid">
        <Field label="Name">
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <Field label="Role profile" hint={db.roles.length ? undefined : 'Create a role profile on the Skills page first to track skill gaps.'}>
          <select value={roleId} onChange={(e) => setRoleId(e.target.value)}>
            <option value="">No role profile</option>
            {db.roles.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
        </Field>
      </div>

      {role && (
        <div className="stack">
          <h3>Current skill levels (0 = none, 5 = expert)</h3>
          <div className="form-grid">
            {role.requirements.map((r) => (
              <Field key={r.skill} label={`${r.skill} (target ${r.target})`}>
                <select value={skills[skillKey(r.skill)] ?? 0} onChange={(e) => setSkills({ ...skills, [skillKey(r.skill)]: Number(e.target.value) })}>
                  {[0, 1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </Field>
            ))}
          </div>
        </div>
      )}

      {showSignals && (
        <details open={Boolean(initial)}>
          <summary>Retention signals (optional)</summary>
          <p className="small muted" style={{ margin: '8px 0 12px' }}>Leave blank what you don&apos;t know. These are used only to start supportive conversations — never for pay, promotion or discipline decisions.</p>
          <div className="form-grid">
            {num('tenureMonths', 'Months in company')}
            {num('monthsSincePromotion', 'Months since last promotion / role change')}
            {num('engagement', 'Latest engagement score (1–5)', 'From your pulse survey')}
            {num('oneOnOnesPerMonth', 'Manager 1:1s per month')}
            {num('overtimeHoursPerWeek', 'Overtime hours per week')}
            {num('compaRatio', 'Compa-ratio', 'Salary ÷ band midpoint, e.g. 0.92', '0.01')}
          </div>
        </details>
      )}

      <div className="modal__foot">
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn--primary" onClick={save} disabled={!name.trim()}>Save</button>
      </div>
    </Modal>
  );
}

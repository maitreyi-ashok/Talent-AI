import { useSyncExternalStore } from 'react';
import { DEFAULT_SETTINGS } from './types';
import type { AgentEvent, DB } from './types';

/**
 * Client cache of the team's data, backed by the Postgres database.
 * Components read with useDB() and change data with update(fn). Changes show instantly, are saved to the
 * server in the background (only the records that changed), and other people's changes arrive via polling.
 */

export const EMPTY_DB: DB = { version: 1, jobs: [], candidates: [], roles: [], employees: [], settings: DEFAULT_SETTINGS, log: [] };

export type SyncMeta = { phase: 'idle' | 'loading' | 'ready' | 'error'; code: string; error: string; saveError: string };
const INITIAL_META: SyncMeta = { phase: 'idle', code: '', error: '', saveError: '' };

let db: DB = EMPTY_DB;
let meta: SyncMeta = INITIAL_META;
let rev = '';
let pending = 0;
let version = 0; // bumped on every local change, so a slow download can't overwrite newer local edits
let queue: Promise<void> = Promise.resolve();
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((l) => l());
const setMeta = (p: Partial<SyncMeta>) => {
  meta = { ...meta, ...p };
  emit();
};
function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export const useDB = (): DB => useSyncExternalStore(subscribe, () => db, () => EMPTY_DB);
export const useSync = (): SyncMeta => useSyncExternalStore(subscribe, () => meta, () => INITIAL_META);
export const getDB = () => db;

export const uid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);

/* ---------- shape ---------- */

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

export function normalize(x: unknown): DB {
  const o = (x ?? {}) as Partial<DB>;
  const log = (Array.isArray(o.log) ? o.log : []).map((e, i) => ({ ...e, id: e.id || `${e.at}-${i}` })) as AgentEvent[];
  return {
    version: 1,
    jobs: (Array.isArray(o.jobs) ? o.jobs : []).slice().sort((a, b) => a.createdAt - b.createdAt),
    candidates: (Array.isArray(o.candidates) ? o.candidates : []).slice().sort((a, b) => a.addedAt - b.addedAt || a.id.localeCompare(b.id)),
    roles: (Array.isArray(o.roles) ? o.roles : []).slice().sort(byName),
    employees: (Array.isArray(o.employees) ? o.employees : []).slice().sort(byName),
    settings: { ...DEFAULT_SETTINGS, ...(o.settings ?? {}) },
    log: log.sort((a, b) => a.at - b.at).slice(-200),
  };
}

/* ---------- diff: send only what changed ---------- */

type Doc = { kind: string; id: string; data: unknown };
type Diff = { upserts: Doc[]; deletes: { kind: string; id: string }[] };

function diffList(kind: string, a: { id: string }[], b: { id: string }[], d: Diff) {
  const before = new Map(a.map((x) => [x.id, x]));
  const after = new Set(b.map((x) => x.id));
  for (const x of b) if (before.get(x.id) !== x) d.upserts.push({ kind, id: x.id, data: x });
  for (const x of a) if (!after.has(x.id)) d.deletes.push({ kind, id: x.id });
}

export function computeDiff(prev: DB, next: DB): Diff {
  const d: Diff = { upserts: [], deletes: [] };
  diffList('job', prev.jobs, next.jobs, d);
  diffList('candidate', prev.candidates, next.candidates, d);
  diffList('role', prev.roles, next.roles, d);
  diffList('employee', prev.employees, next.employees, d);
  diffList('event', prev.log, next.log, d);
  if (prev.settings !== next.settings) d.upserts.push({ kind: 'settings', id: 'main', data: next.settings });
  return d;
}

/* ---------- talking to the server ---------- */

async function request(method: 'GET' | 'POST', url: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, data };
}

export async function loadFromServer(opts: { silent?: boolean } = {}): Promise<void> {
  if (!opts.silent) setMeta({ phase: 'loading', error: '', code: '' });
  const startVersion = version;
  try {
    const r = await request('GET', '/api/db');
    if (!r.ok) {
      const code = r.status === 401 ? 'auth' : String(r.data.code || 'error');
      if (!opts.silent || r.status === 401) setMeta({ phase: 'error', code, error: String(r.data.error || `Request failed (${r.status})`) });
      return;
    }
    if (version !== startVersion || pending > 0) return; // local edits happened meanwhile; try again next poll
    db = normalize(r.data);
    rev = String(r.data.rev ?? '');
    meta = { ...meta, phase: 'ready', error: '', code: '' };
    emit();
  } catch (e) {
    if (!opts.silent) setMeta({ phase: 'error', code: 'network', error: e instanceof Error ? e.message : 'Could not reach the server.' });
  }
}

/** Cheap poll: only downloads everything when someone else changed something. */
export async function refreshIfChanged(): Promise<void> {
  if (meta.phase !== 'ready' || pending > 0) return;
  try {
    const r = await request('GET', '/api/db?check=1');
    if (r.ok && String(r.data.rev) !== rev) await loadFromServer({ silent: true });
  } catch {
    /* offline: try again next time */
  }
}

const MAX_CHUNK = 1_500_000;

async function send(diff: Diff): Promise<void> {
  const chunks: Diff[] = [];
  let cur: Diff = { upserts: [], deletes: diff.deletes };
  let size = 0;
  for (const u of diff.upserts) {
    const n = JSON.stringify(u).length;
    if (cur.upserts.length && (size + n > MAX_CHUNK || cur.upserts.length >= 150)) {
      chunks.push(cur);
      cur = { upserts: [], deletes: [] };
      size = 0;
    }
    cur.upserts.push(u);
    size += n;
  }
  chunks.push(cur);

  for (const chunk of chunks) {
    let lastError = '';
    let done = false;
    for (let attempt = 0; attempt < 3 && !done; attempt++) {
      try {
        const r = await request('POST', '/api/db', chunk);
        if (r.ok) {
          // if nobody else wrote since we last looked, we can keep our revision and skip a re-download
          rev = r.data.prevRev === rev ? String(r.data.rev ?? '') : '';
          done = true;
        } else if (r.status === 401) {
          lastError = 'Your session expired. Sign in again — your latest change was not saved.';
          break;
        } else if (r.status >= 400 && r.status < 500) {
          lastError = String(r.data.error || 'The change was rejected.');
          break;
        } else lastError = String(r.data.error || 'Server error');
      } catch {
        lastError = 'You appear to be offline.';
      }
      if (!done) await new Promise((res) => setTimeout(res, 600 * 2 ** attempt));
    }
    if (!done) {
      setMeta({ saveError: lastError || 'Could not save.' });
      return;
    }
  }
  if (meta.saveError) setMeta({ saveError: '' });
}

/** Apply a change locally right away and save it to the database in the background. */
export function update(fn: (db: DB) => DB): boolean {
  const prev = db;
  const next = fn(prev);
  if (next === prev) return true;
  db = next;
  version++;
  emit();
  const diff = computeDiff(prev, next);
  if (!diff.upserts.length && !diff.deletes.length) return true;
  pending++;
  queue = queue.then(() => send(diff)).finally(() => {
    pending--;
  });
  return true;
}

export function replaceDB(x: unknown) {
  return update(() => normalize(x));
}

/** Resolves when every queued save has finished (used by tests and before sign-out). */
export const flush = () => queue;

export function resetStore() {
  db = EMPTY_DB;
  rev = '';
  meta = INITIAL_META;
  emit();
}

/** Append to the agent activity log. */
export function logEvent(e: Omit<AgentEvent, 'at' | 'id'>) {
  const at = Date.now();
  update((d) => ({ ...d, log: [...d.log, { ...e, at, id: `${at}-${Math.random().toString(36).slice(2, 8)}` }].slice(-200) }));
}

/* ---------- data from the earlier browser-only version ---------- */

const LEGACY_KEY = 'talent-ai:v1';
export function readLegacy(): unknown | null {
  try {
    const raw = window.localStorage.getItem(LEGACY_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
export function retireLegacy() {
  try {
    const raw = window.localStorage.getItem(LEGACY_KEY);
    if (raw) {
      window.localStorage.setItem(`${LEGACY_KEY}:migrated`, raw);
      window.localStorage.removeItem(LEGACY_KEY);
    }
  } catch {
    /* ignore */
  }
}

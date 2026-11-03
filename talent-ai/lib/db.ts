import { neon } from '@neondatabase/serverless';

/**
 * Postgres (Neon) access. One small document table holds everything — jobs, candidates, roles,
 * employees, settings, agent events, and the tests / interviews that candidates open.
 * Add a database from Vercel → Storage → Marketplace → Neon; it sets DATABASE_URL for you.
 */

const url = () => process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_URL_NON_POOLING || '';
export const dbEnabled = () => Boolean(url());

type Row = Record<string, unknown>;
type Runner = (text: string, params?: unknown[]) => Promise<Row[]>;

let runner: Runner | null = null;
let ready: Promise<void> | null = null;

/** Test hook: swap in another SQL runner. */
export function __setRunner(r: Runner | null) {
  runner = r;
  ready = null;
}

async function run(text: string, params: unknown[] = []): Promise<Row[]> {
  if (!runner) {
    const sql = neon(url());
    runner = (t, p) => sql.query(t, p ?? []) as Promise<Row[]>;
  }
  return runner(text, params);
}

export function ensureSchema(): Promise<void> {
  if (!ready) {
    ready = run(
      `CREATE TABLE IF NOT EXISTS ta_entities (
         kind TEXT NOT NULL,
         id TEXT NOT NULL,
         data JSONB NOT NULL,
         updated_at BIGINT NOT NULL,
         PRIMARY KEY (kind, id)
       )`,
    )
      .then(() => undefined)
      .catch((e) => {
        ready = null;
        throw e;
      });
  }
  return ready;
}

const parse = (v: unknown): unknown => {
  if (typeof v === 'string') {
    try {
      return JSON.parse(v);
    } catch {
      return null;
    }
  }
  return v;
};

let lastStamp = 0;
const stamp = () => (lastStamp = Math.max(Date.now(), lastStamp + 1));

export const KINDS = ['job', 'candidate', 'role', 'employee', 'settings', 'event'] as const;
export type Kind = (typeof KINDS)[number];

export async function getDoc<T>(kind: string, id: string): Promise<T | null> {
  await ensureSchema();
  const rows = await run('SELECT data FROM ta_entities WHERE kind = $1 AND id = $2', [kind, id]);
  return rows[0] ? (parse(rows[0].data) as T) : null;
}

export async function putDoc(kind: string, id: string, value: unknown): Promise<void> {
  await ensureSchema();
  await run(
    'INSERT INTO ta_entities (kind, id, data, updated_at) VALUES ($1, $2, $3, $4) ON CONFLICT (kind, id) DO UPDATE SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at',
    [kind, id, JSON.stringify(value), stamp()],
  );
}

export async function delDoc(kind: string, id: string): Promise<void> {
  await ensureSchema();
  await run('DELETE FROM ta_entities WHERE kind = $1 AND id = $2', [kind, id]);
}

const marks = (n: number, from = 1) => Array.from({ length: n }, (_, i) => `$${from + i}`).join(',');

export async function listKinds(kinds: readonly string[]): Promise<{ kind: string; id: string; data: unknown }[]> {
  await ensureSchema();
  const rows = await run(`SELECT kind, id, data FROM ta_entities WHERE kind IN (${marks(kinds.length)})`, [...kinds]);
  return rows.map((r) => ({ kind: String(r.kind), id: String(r.id), data: parse(r.data) }));
}

/** Cheap change detector: count + newest update time of the app's own data. */
export async function revision(kinds: readonly string[] = KINDS): Promise<string> {
  await ensureSchema();
  const rows = await run(`SELECT COUNT(*) AS n, MAX(updated_at) AS m FROM ta_entities WHERE kind IN (${marks(kinds.length)})`, [...kinds]);
  return `${String(rows[0]?.n ?? 0)}:${String(rows[0]?.m ?? 0)}`;
}

export type Changes = { upserts: { kind: string; id: string; data: unknown }[]; deletes: { kind: string; id: string }[] };

export async function applyChanges(c: Changes): Promise<void> {
  await ensureSchema();
  const at = stamp();
  for (let i = 0; i < c.upserts.length; i += 40) {
    const chunk = c.upserts.slice(i, i + 40);
    const values = chunk.map((_, j) => `($${j * 4 + 1}, $${j * 4 + 2}, $${j * 4 + 3}, $${j * 4 + 4})`).join(', ');
    const params = chunk.flatMap((u) => [u.kind, u.id, JSON.stringify(u.data), at]);
    await run(
      `INSERT INTO ta_entities (kind, id, data, updated_at) VALUES ${values} ON CONFLICT (kind, id) DO UPDATE SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at`,
      params,
    );
  }
  const byKind = new Map<string, string[]>();
  for (const d of c.deletes) byKind.set(d.kind, [...(byKind.get(d.kind) ?? []), d.id]);
  for (const [kind, ids] of byKind) {
    for (let i = 0; i < ids.length; i += 100) {
      const part = ids.slice(i, i + 100);
      await run(`DELETE FROM ta_entities WHERE kind = $1 AND id IN (${marks(part.length, 2)})`, [kind, ...part]);
    }
  }
  if (c.upserts.some((u) => u.kind === 'event')) {
    await run("DELETE FROM ta_entities WHERE kind = 'event' AND id NOT IN (SELECT id FROM (SELECT id FROM ta_entities WHERE kind = 'event' ORDER BY updated_at DESC LIMIT 500) AS keep)");
  }
}

/** Housekeeping for candidate-facing records (tests and interviews) older than the given age. */
export async function purgeOld(kinds: string[], olderThanMs: number): Promise<void> {
  await ensureSchema();
  await run(`DELETE FROM ta_entities WHERE kind IN (${marks(kinds.length, 2)}) AND updated_at < $1`, [Date.now() - olderThanMs, ...kinds]);
}

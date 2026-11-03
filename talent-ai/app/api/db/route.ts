import { applyChanges, KINDS, listKinds, revision } from '@/lib/db';
import type { Changes } from '@/lib/db';
import { json } from '@/lib/ai-server';
import { requireSession } from '@/lib/server-guard';

export const runtime = 'nodejs';
export const maxDuration = 30;
export const dynamic = 'force-dynamic';

const ID_RE = /^[A-Za-z0-9_.:-]{1,80}$/;
const MAX_DOC = 400_000; // characters per document
const MAX_BODY = 3_500_000; // stay under Vercel's 4.5 MB request limit
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** GET: everything (or just the revision with ?check=1, for cheap change detection). */
export async function GET(req: Request) {
  const blocked = requireSession(req, { needDb: true });
  if (blocked) return blocked;
  try {
    if (new URL(req.url).searchParams.get('check')) return json({ rev: await revision() });
    const [rev, rows] = await Promise.all([revision(), listKinds(KINDS)]);
    const of = (kind: string) => rows.filter((r) => r.kind === kind).map((r) => r.data);
    const settings = rows.find((r) => r.kind === 'settings')?.data ?? null;
    return json({ rev, jobs: of('job'), candidates: of('candidate'), roles: of('role'), employees: of('employee'), settings, log: of('event') });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Database error.' }, 502);
  }
}

/** POST: apply a set of upserts/deletes. Returns the new revision. */
export async function POST(req: Request) {
  const blocked = requireSession(req, { needDb: true });
  if (blocked) return blocked;

  let raw = '';
  try {
    raw = await req.text();
  } catch {
    return json({ error: 'Invalid request.' }, 400);
  }
  if (raw.length > MAX_BODY) return json({ error: 'That change is too large.' }, 413);

  let body: { upserts?: unknown; deletes?: unknown };
  try {
    body = JSON.parse(raw) as typeof body;
  } catch {
    return json({ error: 'Invalid request.' }, 400);
  }

  const kinds = new Set<string>(KINDS);
  const upserts: Changes['upserts'] = [];
  for (const u of (Array.isArray(body.upserts) ? body.upserts : []).slice(0, 400)) {
    if (!isObj(u) || typeof u.kind !== 'string' || typeof u.id !== 'string' || !kinds.has(u.kind) || !ID_RE.test(u.id) || !isObj(u.data)) {
      return json({ error: 'Invalid change.' }, 400);
    }
    if (JSON.stringify(u.data).length > MAX_DOC) return json({ error: 'One record is too large to save.' }, 413);
    upserts.push({ kind: u.kind, id: u.id, data: u.data });
  }
  const deletes: Changes['deletes'] = [];
  for (const d of (Array.isArray(body.deletes) ? body.deletes : []).slice(0, 1000)) {
    if (!isObj(d) || typeof d.kind !== 'string' || typeof d.id !== 'string' || !kinds.has(d.kind) || !ID_RE.test(d.id)) return json({ error: 'Invalid change.' }, 400);
    deletes.push({ kind: d.kind, id: d.id });
  }

  try {
    const prevRev = await revision();
    await applyChanges({ upserts, deletes });
    return json({ rev: await revision(), prevRev });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Database error.' }, 502);
  }
}

'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { loadFromServer, readLegacy, refreshIfChanged, replaceDB, retireLegacy, useDB, useSync } from '@/lib/store';
import { useAI } from '@/lib/ai-client';
import { Notice } from './ui';

function Setup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="card stack" style={{ maxWidth: 640, margin: '40px auto' }}>
      <h1 style={{ fontSize: '1.375rem' }}>{title}</h1>
      {children}
    </div>
  );
}

function Login() {
  const ai = useAI();
  const [pass, setPass] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Setup title="Sign in to Talent AI">
      <p className="muted">This workspace holds candidate and employee data, so it is protected by your team&apos;s passcode.</p>
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setErr((await ai.login(pass)) ?? '');
          setBusy(false);
        }}
      >
        <input type="password" aria-label="Team passcode" placeholder="Team passcode" value={pass} onChange={(e) => setPass(e.target.value)} autoFocus autoComplete="current-password" />
        {err && <Notice tone="bad">{err}</Notice>}
        <div><button type="submit" className="btn btn--primary" disabled={!pass || busy}>{busy ? 'Signing in…' : 'Sign in'}</button></div>
      </form>
    </Setup>
  );
}

/** Decides what to show: setup help, sign-in, loading, or the app itself. Also polls for other people's changes. */
export default function AppGate({ children }: { children: ReactNode }) {
  const ai = useAI();
  const sync = useSync();
  const db = useDB();
  const [legacy, setLegacy] = useState<unknown | null>(null);

  const ready = Boolean(ai.status?.dbReady && ai.authed);

  useEffect(() => {
    if (ready && sync.phase === 'idle') void loadFromServer();
  }, [ready, sync.phase]);

  useEffect(() => {
    if (sync.phase === 'error' && sync.code === 'auth') void ai.refresh();
  }, [sync.phase, sync.code, ai]);

  useEffect(() => {
    if (sync.phase !== 'ready') return;
    const empty = !db.jobs.length && !db.candidates.length && !db.roles.length && !db.employees.length;
    setLegacy(empty ? readLegacy() : null);
  }, [sync.phase, db.jobs.length, db.candidates.length, db.roles.length, db.employees.length]);

  useEffect(() => {
    if (sync.phase !== 'ready') return;
    const tick = () => document.visibilityState === 'visible' && void refreshIfChanged();
    const id = setInterval(tick, 20_000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [sync.phase]);

  if (!ai.status) return <p className="muted">Loading…</p>;

  if (!ai.status.passcodeSet && !ai.status.openAccess) {
    return (
      <Setup title="One more setup step: a team passcode">
        <p className="muted">This app stores personal data, so it will not run without a passcode. In Vercel → Project → Settings → Environment Variables add:</p>
        <ul className="small" style={{ margin: 0, paddingLeft: 20 }}>
          <li><code>APP_PASSCODE</code> — a long passphrase your team will use to sign in</li>
        </ul>
        <p className="small muted">Then redeploy.</p>
      </Setup>
    );
  }

  if (!ai.status.dbReady) {
    return (
      <Setup title="Connect a database">
        <p className="muted">Talent AI stores jobs, candidates, tests and interviews in Postgres. The quickest way:</p>
        <ol className="small" style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <li>In your Vercel project open <strong>Storage</strong> → <strong>Create Database</strong> → <strong>Neon (Postgres)</strong> and connect it to this project.</li>
          <li>Vercel adds <code>DATABASE_URL</code> automatically. Redeploy.</li>
          <li>The app creates its one table on first use — nothing to run by hand.</li>
        </ol>
        <p className="small muted">Running locally? Put a Neon connection string in <code>.env.local</code> as <code>DATABASE_URL</code>.</p>
      </Setup>
    );
  }

  if (!ai.authed) return <Login />;

  if (sync.phase === 'idle' || sync.phase === 'loading') return <p className="muted">Loading your workspace…</p>;

  if (sync.phase === 'error') {
    return (
      <Setup title="Could not load your data">
        <Notice tone="bad">{sync.error}</Notice>
        <div><button type="button" className="btn btn--primary" onClick={() => void loadFromServer()}>Try again</button></div>
      </Setup>
    );
  }

  return (
    <>
      {sync.saveError && (
        <div style={{ marginBottom: 12 }}>
          <Notice tone="bad">{sync.saveError}</Notice>
        </div>
      )}
      {legacy !== null && (
        <div style={{ marginBottom: 12 }}>
          <Notice tone="info">
            <div className="row row--between">
              <span>This browser has data from the earlier browser-only version. Move it into the shared database?</span>
              <span className="row">
                <button type="button" className="btn btn--sm btn--primary" onClick={() => { replaceDB(legacy); retireLegacy(); setLegacy(null); }}>Move it</button>
                <button type="button" className="btn btn--sm" onClick={() => { retireLegacy(); setLegacy(null); }}>Not now</button>
              </span>
            </div>
          </Notice>
        </div>
      )}
      {children}
    </>
  );
}

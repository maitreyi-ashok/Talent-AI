'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { useAI } from '@/lib/ai-client';
import AppGate from './AppGate';
import AgentRunner from './AgentRunner';

const LINKS = [
  { href: '/', label: 'Overview' },
  { href: '/hiring', label: 'Hiring' },
  { href: '/agent', label: 'Agent' },
  { href: '/skills', label: 'Skills' },
  { href: '/retention', label: 'Retention' },
  { href: '/settings', label: 'Settings' },
];

export default function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const ai = useAI();
  const { status, authed, aiOn } = ai;
  const chip = !status || !authed ? null : aiOn ? { tone: 'on', text: 'AI on' } : { tone: 'off', text: 'Rules mode' };

  return (
    <>
      <header className="topbar">
        <Link href="/" className="brand" aria-label="Talent AI — overview">
          <span className="brand__mark" aria-hidden="true">T</span>
          <span className="brand__name">Talent AI</span>
        </Link>
        <nav aria-label="Primary" className="nav" hidden={!authed}>
          {LINKS.map((l) => {
            const active = l.href === '/' ? pathname === '/' : pathname.startsWith(l.href);
            return (
              <Link key={l.href} href={l.href} className={active ? 'active' : undefined} aria-current={active ? 'page' : undefined}>
                {l.label}
              </Link>
            );
          })}
        </nav>
        {chip && (
          <Link href="/settings" className={`chip chip--${chip.tone}`} title="AI status — open Settings">
            {chip.text}
          </Link>
        )}
        {authed && status && !status.openAccess && (
          <button type="button" className="btn btn--sm btn--ghost" onClick={() => void ai.logout()}>Sign out</button>
        )}
      </header>
      <main className="page">
        <AppGate>{children}</AppGate>
        <AgentRunner />
      </main>
      <footer className="foot">
        AI recommends, people decide. Data is stored in your team&apos;s database.{' '}
        <Link href="/settings">Privacy &amp; data</Link>
      </footer>
    </>
  );
}

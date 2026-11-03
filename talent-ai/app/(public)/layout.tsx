import type { Metadata } from 'next';
import type { ReactNode } from 'react';

// Candidate-facing pages: no recruiter navigation, and kept out of search engines.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <header className="topbar">
        <span className="brand"><span className="brand__mark" aria-hidden="true">T</span><span className="brand__name">Hiring</span></span>
      </header>
      <main className="page page--narrow">{children}</main>
      <footer className="foot">Questions or need adjustments (extra time, another format)? Just reply to the email you received.</footer>
    </>
  );
}

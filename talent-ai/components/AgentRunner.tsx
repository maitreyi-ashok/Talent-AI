'use client';

import { useEffect } from 'react';
import { runAgentOnce } from '@/lib/agent';
import { useAI } from '@/lib/ai-client';
import { useSync } from '@/lib/store';

/** Keeps the agent working while the app is open: checks for submitted tests and, in auto mode, takes the next step. */
export default function AgentRunner() {
  const ai = useAI();
  const sync = useSync();
  const ready = ai.authed && sync.phase === 'ready' && ai.status?.dbReady;
  const mailReady = Boolean(ai.status?.mailReady);

  useEffect(() => {
    if (!ready) return;
    const go = () => document.visibilityState === 'visible' && void runAgentOnce(ai.api, mailReady, window.location.origin);
    const first = setTimeout(go, 3000);
    const id = setInterval(go, 60_000);
    document.addEventListener('visibilitychange', go);
    return () => {
      clearTimeout(first);
      clearInterval(id);
      document.removeEventListener('visibilitychange', go);
    };
  }, [ready, mailReady, ai.api]);

  return null;
}

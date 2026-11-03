'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Job, Profile, ScreeningResult } from './types';
import type { Gap, LearningPlan } from './skills';
import { resetStore } from './store';

export type AIStatus = {
  authenticated: boolean;
  openAccess: boolean;
  passcodeSet: boolean;
  dbReady: boolean;
  aiAvailable: boolean;
  mailReady: boolean;
  videoProvider: 'daily' | 'jitsi';
  model: string;
};

type ScreenOut = { profile: Profile; screening: ScreeningResult };

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(message: string, status: number, code = '') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

type Ctx = {
  status: AIStatus | null;
  authed: boolean;
  aiOn: boolean;
  login: (passcode: string) => Promise<string | null>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  /** JSON call to this app's own API. Throws ApiError with the server's message. */
  api: <T>(method: 'GET' | 'POST' | 'DELETE', url: string, body?: unknown) => Promise<T>;
  screen: (job: Job, resumeText: string, pdfBase64?: string) => Promise<ScreenOut>;
  plan: (roleName: string, gaps: Gap[]) => Promise<LearningPlan>;
};

const AIContext = createContext<Ctx | null>(null);

export async function api<T>(method: 'GET' | 'POST' | 'DELETE', url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string } & T;
  if (!res.ok) throw new ApiError(data.error || `Request failed (${res.status})`, res.status, data.code);
  return data;
}

export function AIProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AIStatus | null>(null);

  const refresh = useCallback(async () => {
    try {
      setStatus(await api<AIStatus>('GET', '/api/status'));
    } catch {
      setStatus({ authenticated: false, openAccess: false, passcodeSet: false, dbReady: false, aiAvailable: false, mailReady: false, videoProvider: 'jitsi', model: '' });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(
    async (passcode: string) => {
      try {
        await api('POST', '/api/auth/login', { passcode });
        await refresh();
        return null;
      } catch (e) {
        return e instanceof Error ? e.message : 'Could not sign in.';
      }
    },
    [refresh],
  );

  const logout = useCallback(async () => {
    try {
      await api('POST', '/api/auth/logout', {});
    } finally {
      resetStore();
      await refresh();
    }
  }, [refresh]);

  const value = useMemo<Ctx>(() => {
    const authed = Boolean(status?.authenticated);
    return {
      status,
      authed,
      aiOn: authed && Boolean(status?.aiAvailable),
      login,
      logout,
      refresh,
      api,
      screen: (job, resumeText, pdfBase64) =>
        api<ScreenOut>('POST', '/api/screen', {
          job: { title: job.title, department: job.department, description: job.description, mustHave: job.mustHave, niceToHave: job.niceToHave, minYears: job.minYears },
          resumeText,
          pdfBase64,
        }),
      plan: (roleName, gaps) => api<LearningPlan>('POST', '/api/plan', { roleName, gaps }),
    };
  }, [status, login, logout, refresh]);

  return <AIContext.Provider value={value}>{children}</AIContext.Provider>;
}

export function useAI(): Ctx {
  const ctx = useContext(AIContext);
  if (!ctx) throw new Error('useAI must be used inside <AIProvider>');
  return ctx;
}

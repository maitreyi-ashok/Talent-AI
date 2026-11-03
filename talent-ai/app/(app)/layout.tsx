import type { ReactNode } from 'react';
import { AIProvider } from '@/lib/ai-client';
import Shell from '@/components/Shell';

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <AIProvider>
      <Shell>{children}</Shell>
    </AIProvider>
  );
}

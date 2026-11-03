import { json } from '@/lib/ai-server';
import { clearedCookie } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function POST() {
  const res = json({ ok: true });
  res.headers.append('set-cookie', clearedCookie());
  return res;
}

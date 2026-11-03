'use client';

import { useEffect, useState } from 'react';

type Iv = {
  status: 'waiting' | 'open' | 'ended' | 'cancelled';
  jobTitle: string;
  candidateName?: string;
  startsAt: number;
  durationMin: number;
  opensAt: number;
  roomUrl: string | null;
};

const icsDate = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');

function downloadIcs(iv: Iv, id: string) {
  const body = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Talent AI//EN', 'BEGIN:VEVENT',
    `UID:${id}@talent-ai`, `DTSTAMP:${icsDate(Date.now())}`, `DTSTART:${icsDate(iv.startsAt)}`, `DTEND:${icsDate(iv.startsAt + iv.durationMin * 60_000)}`,
    `SUMMARY:${esc(`Video interview — ${iv.jobTitle}`)}`, `DESCRIPTION:${esc(`Join from this page: ${window.location.href}`)}`, 'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
  const url = URL.createObjectURL(new Blob([body], { type: 'text/calendar;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'interview.ics';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function InterviewPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const [iv, setIv] = useState<Iv | null>(null);
  const [error, setError] = useState('');
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const res = await fetch(`/api/public/interview/${id}`, { cache: 'no-store' });
        const j = (await res.json()) as Iv & { error?: string };
        if (stop) return;
        if (!res.ok) setError(j.error || 'This link is not valid.');
        else setIv(j);
      } catch {
        if (!stop) setError('Could not load the interview details. Check your connection and refresh.');
      }
    };
    void load();
    const poll = setInterval(load, 20_000); // the join link appears automatically when the window opens
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      stop = true;
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [id]);

  if (error) return <div className="card"><h1>Link problem</h1><p className="muted" style={{ marginTop: 8 }}>{error}</p></div>;
  if (!iv) return <p className="muted">Loading…</p>;

  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const startText = new Date(iv.startsAt).toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short' });
  const untilOpen = Math.max(0, Math.round((iv.opensAt - now) / 1000));
  const mins = Math.floor(untilOpen / 60);
  const countdown = untilOpen >= 86400 ? `${Math.floor(untilOpen / 86400)} day(s)` : untilOpen >= 3600 ? `${Math.floor(untilOpen / 3600)} h ${mins % 60} min` : `${mins} min ${untilOpen % 60} s`;

  return (
    <div className="card stack">
      <p className="small muted">{iv.jobTitle}</p>
      <h1>Your video interview{iv.candidateName ? `, ${iv.candidateName}` : ''}</h1>

      {iv.status === 'cancelled' && <p role="status">This interview was cancelled. Please check your email — we will be in touch.</p>}
      {iv.status === 'ended' && <p role="status">This interview window has ended. If you missed it, reply to the email you received and we will find another time.</p>}

      {(iv.status === 'waiting' || iv.status === 'open') && (
        <>
          <div>
            <div style={{ fontSize: '1.125rem', fontWeight: 600 }}>{startText}</div>
            <div className="small muted">{tz} · about {iv.durationMin} minutes</div>
          </div>

          {iv.status === 'open' && iv.roomUrl ? (
            <div className="stack">
              <p>The room is open. Allow camera and microphone access when your browser asks.</p>
              <div><a className="btn btn--primary" href={iv.roomUrl} target="_blank" rel="noopener noreferrer">Join video interview</a></div>
            </div>
          ) : (
            <p role="status" className="muted">The Join button appears 15 minutes before the start (in {countdown}). You can leave this page open — it updates by itself.</p>
          )}

          <div><button type="button" className="btn btn--sm" onClick={() => downloadIcs(iv, id)}>Add to calendar</button></div>

          <ul className="small muted" style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <li>Use a laptop or phone with a camera and microphone, and a quiet spot with a stable connection.</li>
            <li>Chrome, Edge, Safari or Firefox all work. No account or download is needed.</li>
            <li>Need a different time or any adjustment? Reply to the email you received.</li>
          </ul>
        </>
      )}
    </div>
  );
}

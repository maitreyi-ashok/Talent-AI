/* Email wording. Built server-side from a few fixed parameters so the endpoint can't be used as a general mail relay. */

export type InviteParams = {
  candidateName?: string;
  jobTitle: string;
  company?: string;
  link: string;
  timeLimitMin?: number; // test
  startsAt?: number; // interview (ms)
  durationMin?: number; // interview
  timeZoneLabel?: string; // e.g. "Asia/Kolkata" — shown beside the time
};

const first = (n?: string) => (n ? n.trim().split(/\s+/)[0] : '');
const hello = (n?: string) => (first(n) ? `Hi ${first(n)},` : 'Hello,');
const at = (c?: string) => (c ? ` at ${c}` : '');
const clean = (s: string, max = 120) => s.replace(/[\r\n]+/g, ' ').trim().slice(0, max);

export function testInvite(p: InviteParams): { subject: string; text: string } {
  const job = clean(p.jobTitle);
  const mins = p.timeLimitMin ? `${p.timeLimitMin} minutes` : 'a short time';
  return {
    subject: `Next step: a short assessment for ${job}${at(p.company ? clean(p.company, 60) : '')}`,
    text: [
      hello(p.candidateName),
      '',
      `Thank you for applying for ${job}${at(p.company ? clean(p.company, 60) : '')}. We were impressed by your resume and would like to invite you to the next step: a short online assessment.`,
      '',
      `• It takes about ${mins} once you start, and you can begin whenever suits you within the next 14 days.`,
      '• Please do it on your own, on a laptop or desktop if possible.',
      '• You do not need to prepare anything special.',
      '',
      `Start here: ${p.link}`,
      '',
      'If you need any adjustment (extra time, a different format, accessibility support), just reply to this email before you start and we will arrange it.',
      '',
      'Good luck, and thanks again for your interest.',
    ].join('\n'),
  };
}

export function interviewInvite(p: InviteParams): { subject: string; text: string } {
  const job = clean(p.jobTitle);
  const when = p.startsAt
    ? new Date(p.startsAt).toLocaleString('en-GB', { dateStyle: 'full', timeStyle: 'short', timeZone: p.timeZoneLabel || 'UTC' }) + ` (${p.timeZoneLabel || 'UTC'})`
    : 'the time shown on the page';
  return {
    subject: `Video interview for ${job}${at(p.company ? clean(p.company, 60) : '')}`,
    text: [
      hello(p.candidateName),
      '',
      `Congratulations — you passed the assessment for ${job}${at(p.company ? clean(p.company, 60) : '')}. We would like to meet you for a video interview.`,
      '',
      `When: ${when}`,
      `Length: about ${p.durationMin ?? 30} minutes`,
      `Join: ${p.link}`,
      '',
      'The link opens a page with a Join button that becomes active shortly before the start. You only need a browser, a camera and a microphone.',
      '',
      'If this time does not work, or you need any adjustment, reply to this email and we will find another slot.',
      '',
      'Looking forward to speaking with you.',
    ].join('\n'),
  };
}

export const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function toHtml(text: string): string {
  const linked = escapeHtml(text).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>');
  return `<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;font-size:15px;line-height:1.6;color:#111">${linked.replace(/\n/g, '<br>')}</div>`;
}

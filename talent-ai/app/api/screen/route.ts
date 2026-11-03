import { callClaude, coerceScreening, extractJSON, json, SCREEN_SYSTEM } from '@/lib/ai-server';
import { guard } from '@/lib/server-guard';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const MAX_TEXT = 60_000;
const MAX_PDF_B64 = 4_400_000; // ≈3.3 MB file; Vercel's request limit is 4.5 MB

type Body = {
  job?: { title?: unknown; department?: unknown; description?: unknown; mustHave?: unknown; niceToHave?: unknown; minYears?: unknown };
  resumeText?: unknown;
  pdfBase64?: unknown;
};

const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 30) : []);

export async function POST(req: Request) {
  const blocked = guard(req);
  if (blocked) return blocked;

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return json({ error: 'Invalid request.' }, 400);
  }

  const job = body.job ?? {};
  const title = typeof job.title === 'string' ? job.title.slice(0, 120) : '';
  if (!title) return json({ error: 'The job needs a title.' }, 400);
  const resumeText = typeof body.resumeText === 'string' ? body.resumeText.slice(0, MAX_TEXT) : '';
  const pdf = typeof body.pdfBase64 === 'string' ? body.pdfBase64 : '';
  if (!resumeText && !pdf) return json({ error: 'No resume provided.' }, 400);
  if (pdf.length > MAX_PDF_B64) return json({ error: 'PDF is too large (max about 3 MB).' }, 413);

  const jobText = [
    `Job title: ${title}`,
    typeof job.department === 'string' && job.department ? `Department: ${job.department.slice(0, 80)}` : '',
    `Must-have: ${list(job.mustHave).join('; ') || '(none listed)'}`,
    `Nice-to-have: ${list(job.niceToHave).join('; ') || '(none listed)'}`,
    typeof job.minYears === 'number' && job.minYears > 0 ? `Minimum relevant experience: ${job.minYears} years` : '',
    typeof job.description === 'string' && job.description ? `Description:\n${job.description.slice(0, 4000)}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  try {
    const content = pdf
      ? [
          { type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: pdf } },
          { type: 'text' as const, text: `<job>\n${jobText}\n</job>\n\nThe resume is the attached PDF. Screen it against the job.` },
        ]
      : [{ type: 'text' as const, text: `<job>\n${jobText}\n</job>\n\n<resume>\n${resumeText}\n</resume>\n\nScreen the resume against the job.` }];
    const reply = await callClaude(SCREEN_SYSTEM, content);
    return json(coerceScreening(extractJSON(reply)));
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Screening failed.' }, 502);
  }
}

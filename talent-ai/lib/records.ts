import type { Question } from './types';
import type { Answer, Graded, ShortGrade } from './grading';

export type TestRecord = {
  id: string;
  jobTitle: string;
  candidateName: string;
  title: string;
  instructions: string;
  timeLimitMin: number;
  passMarkPct: number;
  questions: Question[]; // includes the answer key — never sent to candidates
  createdAt: number;
  expiresAt: number;
  startedAt?: number;
  submittedAt?: number;
  answers?: Answer[];
  graded?: Graded;
  shortGrades?: Record<string, ShortGrade>;
  late?: boolean;
};

export type InterviewRecord = {
  id: string;
  jobTitle: string;
  candidateName: string;
  startsAt: number;
  durationMin: number;
  roomUrl: string;
  provider: 'daily' | 'jitsi';
  status: 'scheduled' | 'cancelled';
};

export const DAY = 86_400_000;
export const TEST_VALID_DAYS = 14;
export const firstName = (n: string) => n.trim().split(/\s+/)[0] ?? '';

import type { Candidate, Employee, Job, RoleProfile } from './types';
import { emptySignals } from './types';
import { uid, update } from './store';

/* Optional, clearly fictional sample data so you can try the app without real people's data. */

const RESUMES: { name: string; text: string }[] = [
  {
    name: 'sample-candidate-a.txt',
    text: `Sample Candidate A
Customer success analyst
candidate.a@example.com

Summary
6 years in customer success and analytics for B2B software companies.

Experience
Senior Customer Success Analyst — Example SaaS Co (2021-2025)
- Built SQL reports on churn and product usage for 120 enterprise accounts.
- Created Excel models and Tableau dashboards used in quarterly business reviews.
- Led customer success calls with account owners and improved renewal rate by 8 percent.
- Strong written and verbal communication with customers and engineers.
Customer Support Specialist — Sample Retail Ltd (2019-2021)
- Resolved 40+ tickets a day and documented fixes in Salesforce.

Education
B.Sc. Statistics`,
  },
  {
    name: 'sample-candidate-b.txt',
    text: `Sample Candidate B
Operations coordinator
candidate.b@example.com

2 years of experience coordinating operations for a logistics company.
- Maintained weekly Excel trackers and reports for the operations manager.
- Good communication with drivers, vendors and clients.
- Basic reporting; currently learning SQL through an online course.

Education
Diploma in Business Administration`,
  },
  {
    name: 'sample-candidate-c.txt',
    text: `Sample Candidate C
Recent graduate
candidate.c@example.com

Looking for an entry level role. Completed a bachelor degree in Mathematics.
Final-year project: a small Python script that cleaned a CSV file.
Member of the university debate team.`,
  },
];

export function addSampleData(): void {
  const now = Date.now();
  const job: Job = {
    id: uid(),
    title: 'Customer Success Analyst (sample)',
    department: 'Customer Success',
    location: 'Remote',
    description: 'Analyse customer usage and churn, build reports and help account owners keep customers successful.',
    mustHave: ['SQL', 'Excel', 'Customer success', 'Communication'],
    niceToHave: ['Tableau', 'Salesforce'],
    minYears: 2,
    createdAt: now,
    sample: true,
  };
  const candidates: Candidate[] = RESUMES.map((r, i) => ({
    id: uid(),
    jobId: job.id,
    fileName: r.name,
    resumeText: r.text,
    profile: { name: '', email: '', headline: '', yearsExperience: null, skills: [], education: [] },
    stage: 'new',
    notes: '',
    addedAt: now + i,
    sample: true,
  }));

  const role: RoleProfile = {
    id: uid(),
    name: 'Data Analyst (sample)',
    requirements: [
      { skill: 'SQL', target: 4 },
      { skill: 'Excel', target: 3 },
      { skill: 'Data visualisation', target: 3 },
      { skill: 'Communication', target: 3 },
    ],
    sample: true,
  };
  const mk = (name: string, skills: Record<string, number>, s: Partial<ReturnType<typeof emptySignals>>): Employee => ({
    id: uid(),
    name,
    roleId: role.id,
    skills,
    signals: { ...emptySignals(), ...s },
    sample: true,
  });
  const employees: Employee[] = [
    mk('Sample Employee 1', { sql: 4, excel: 3, 'data visualisation': 2, communication: 4 }, { tenureMonths: 30, monthsSincePromotion: 14, engagement: 4, oneOnOnesPerMonth: 4, overtimeHoursPerWeek: 2, compaRatio: 1.02 }),
    mk('Sample Employee 2', { sql: 2, excel: 4, 'data visualisation': 1, communication: 3 }, { tenureMonths: 44, monthsSincePromotion: 40, engagement: 2, oneOnOnesPerMonth: 1, overtimeHoursPerWeek: 11, compaRatio: 0.88 }),
    mk('Sample Employee 3', { sql: 3, excel: 2, 'data visualisation': 3, communication: 2 }, { tenureMonths: 9, monthsSincePromotion: 9, engagement: 3, oneOnOnesPerMonth: 2, overtimeHoursPerWeek: 4, compaRatio: 0.97 }),
    mk('Sample Employee 4', { sql: 5, excel: 5, 'data visualisation': 4, communication: 4 }, { tenureMonths: 60, monthsSincePromotion: 26, engagement: 4, oneOnOnesPerMonth: 2 }),
  ];

  update((db) => ({
    ...db,
    jobs: [...db.jobs, job],
    candidates: [...db.candidates, ...candidates],
    roles: [...db.roles, role],
    employees: [...db.employees, ...employees],
  }));
}

export function removeSampleData(): void {
  update((db) => ({
    ...db,
    jobs: db.jobs.filter((j) => !j.sample),
    candidates: db.candidates.filter((c) => !c.sample),
    roles: db.roles.filter((r) => !r.sample),
    employees: db.employees.filter((e) => !e.sample),
  }));
}

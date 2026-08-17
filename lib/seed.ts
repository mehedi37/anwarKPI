import { db, now, isSeeded } from './db';
import { storeEvidenceFile } from './evidence';
import { computeAchievement, FORMULA_VERSION, type KpiType, type Milestone } from './scoring';

/**
 * Demo data for Anwar Group. BDT throughout, plausible departments, and one
 * KPI of every type so the edge-case handling is visible in the UI rather than
 * only described in the design doc.
 *
 * Three periods, because the dashboard spec asks for "KPIs consistently below
 * target" (3+ consecutive periods) and "performance trend over time".
 */

const SALES_REPORT_MISMATCH = `ANWAR GROUP OF INDUSTRIES
Consumer Division — Monthly Sales Report
Period: August 2026
Prepared by: Sales Operations

--------------------------------------------------
Territory            Invoiced (BDT)     Units
--------------------------------------------------
Dhaka North             3,120,000       1,040
Dhaka South             2,480,000         827
Chattogram              1,760,000         587
Sylhet                    640,000         213
Khulna                    400,000         133
--------------------------------------------------
TOTAL NET SALES         8,400,000       2,800
--------------------------------------------------

Note: Two Chattogram orders (BDT 600,000) were cancelled
after dispatch and are excluded from net sales above.
Gross invoiced value before cancellations: 9,000,000.
`;

const SALES_REPORT_MATCH = `ANWAR GROUP OF INDUSTRIES
Consumer Division — Monthly Sales Report (FINAL)
Period: August 2026
Prepared by: Sales Operations

--------------------------------------------------
Territory            Invoiced (BDT)     Units
--------------------------------------------------
Dhaka North             3,340,000       1,113
Dhaka South             2,660,000         887
Chattogram              1,880,000         627
Sylhet                    680,000         227
Khulna                    440,000         146
--------------------------------------------------
TOTAL NET SALES         9,000,000       3,000
--------------------------------------------------
`;

const DOWNTIME_LOG = `ANWAR GROUP — Production Line Downtime Log
Period: August 2026 | Line: PL-02

Date        Reason                    Hours
2026-08-03  Scheduled maintenance      4.0
2026-08-09  Motor bearing failure      9.5
2026-08-17  Power interruption         3.0
2026-08-22  Conveyor jam               6.0
2026-08-28  Scheduled maintenance      3.5
                                      -----
TOTAL DOWNTIME                         26.0 hours
`;



type RecordSpec = {
  employee_id: number;
  period_id: number;
  name: string;
  description?: string;
  type: KpiType;
  target?: number | null;
  unit?: string;
  weight: number;
  reviewer_id: number;
  approver_id: number;
  /** omit to leave the KPI pending (assigned, no result yet) */
  actual?: number | null;
  rubric_level?: number | null;
  milestones?: Milestone[];
  rubric?: { level: number; label: string; criteria: string; pct: number }[];
  source?: 'system' | 'manual';
  source_detail?: string;
  comment?: string;
  evidence?: { filename: string; body: string }[];
  /** final state; 'draft' means assigned but nothing entered */
  state: 'draft' | 'submitted' | 'under_review' | 'approved';
  as_of?: string;
};

/** Seed on first run so the app is demo-ready with no setup step. */
export function ensureSeeded() {
  if (!isSeeded()) seed();
}

export function seed() {
  const conn = db();

  const tx = conn.transaction(() => {
    // ---- Departments -----------------------------------------------------
    const dept = conn.prepare(`INSERT INTO department (id, name, business_unit) VALUES (?,?,?)`);
    dept.run(1, 'Sales', 'Consumer Division');
    dept.run(2, 'Production', 'Industrial Division');
    dept.run(3, 'Quality Control', 'Industrial Division');
    dept.run(4, 'Supply Chain', 'Industrial Division');

    // ---- People ----------------------------------------------------------
    const emp = conn.prepare(
      `INSERT INTO employee (id, name, title, dept_id, manager_id, role) VALUES (?,?,?,?,?,?)`,
    );
    emp.run(5, 'Kamrul Islam', 'Sales Manager', 1, null, 'manager');
    emp.run(6, 'Farhana Chowdhury', 'Operations Manager', 2, null, 'manager');
    emp.run(7, 'Mahbub Rahman', 'Head of Business Unit', 1, null, 'approver');
    emp.run(8, 'Ayesha Siddiqua', 'HR Business Partner', 1, null, 'hr');
    emp.run(1, 'Rafiq Ahmed', 'Senior Sales Executive', 1, 5, 'employee');
    emp.run(2, 'Nasrin Sultana', 'Production Supervisor', 2, 6, 'employee');
    emp.run(3, 'Tanvir Hossain', 'QC Officer', 3, 6, 'employee');
    emp.run(4, 'Shirin Akter', 'Supply Chain Officer', 4, 6, 'employee');

    // ---- Periods ---------------------------------------------------------
    const per = conn.prepare(
      `INSERT INTO period (id, label, type, start_date, end_date, status) VALUES (?,?,?,?,?,?)`,
    );
    per.run(1, 'June 2026', 'month', '2026-06-01', '2026-06-30', 'closed');
    per.run(2, 'July 2026', 'month', '2026-07-01', '2026-07-31', 'closed');
    per.run(3, 'August 2026', 'month', '2026-08-01', '2026-08-31', 'open');

    // ---- Closed periods: enough history for trends and recurring gaps -----
    // Nasrin's downtime is below target in all three periods on purpose — it is
    // what makes the "KPIs consistently below target" widget show something.
    for (const [pid, sales, complaints, output, downtime, defect, otd] of [
      [1, 9_600_000, 4, 48_200, 24, 1.4, 93],
      [2, 8_800_000, 6, 46_900, 25, 1.1, 92],
    ] as const) {
      full({
        employee_id: 1, period_id: pid, name: 'Monthly Sales', type: 'standard',
        target: 10_000_000, unit: 'BDT', weight: 60, reviewer_id: 5, approver_id: 7,
        actual: sales, source: 'system', source_detail: 'Sales System export',
        state: 'approved',
      });
      full({
        employee_id: 1, period_id: pid, name: 'Customer Complaints', type: 'inverse',
        target: 5, unit: 'complaints', weight: 40, reviewer_id: 5, approver_id: 7,
        actual: complaints, source: 'system', source_detail: 'CRM export',
        state: 'approved',
      });
      full({
        employee_id: 2, period_id: pid, name: 'Production Output', type: 'standard',
        target: 50_000, unit: 'units', weight: 60, reviewer_id: 6, approver_id: 7,
        actual: output, source: 'system', source_detail: 'MES export',
        state: 'approved',
      });
      full({
        employee_id: 2, period_id: pid, name: 'Downtime Hours', type: 'inverse',
        target: 20, unit: 'hours', weight: 40, reviewer_id: 6, approver_id: 7,
        actual: downtime, source: 'system', source_detail: 'MES export',
        state: 'approved',
      });
      full({
        employee_id: 3, period_id: pid, name: 'Defect Rate', type: 'inverse',
        target: 2, unit: '%', weight: 100, reviewer_id: 6, approver_id: 7,
        actual: defect, source: 'system', source_detail: 'QC system export',
        state: 'approved',
      });
      full({
        employee_id: 4, period_id: pid, name: 'On-time Delivery', type: 'standard',
        target: 95, unit: '%', weight: 100, reviewer_id: 6, approver_id: 7,
        actual: otd, source: 'system', source_detail: 'Logistics export',
        state: 'approved',
      });
    }

    // ---- August 2026 (open) ----------------------------------------------

    // Rafiq — the demo walkthrough employee. Monthly Sales is the PDF's own
    // example row and is left in `draft` so the demo can walk the full flow:
    // enter actual -> attach evidence -> score -> review -> approve -> dashboard.
    full({
      employee_id: 1, period_id: 3, name: 'Monthly Sales',
      description: 'Net invoiced sales for the Consumer Division territory.',
      type: 'standard', target: 10_000_000, unit: 'BDT', weight: 30,
      reviewer_id: 5, approver_id: 7, state: 'draft',
    });
    full({
      employee_id: 1, period_id: 3, name: 'Customer Complaints',
      description: 'Complaints logged against this territory. Lower is better.',
      type: 'inverse', target: 5, unit: 'complaints', weight: 20,
      reviewer_id: 5, approver_id: 7,
      actual: 3, source: 'system', source_detail: 'CRM export, 01 Sep 2026',
      state: 'submitted',
    });
    full({
      employee_id: 1, period_id: 3, name: 'New Dealer Onboarding',
      description: 'Onboard four new dealers on the agreed schedule.',
      type: 'milestone', weight: 25, reviewer_id: 5, approver_id: 7,
      milestones: [
        { title: 'Shortlist candidates', sub_weight: 1, due_date: '2026-08-07', completed_date: '2026-08-06' },
        { title: 'Credit checks complete', sub_weight: 1, due_date: '2026-08-14', completed_date: '2026-08-13' },
        { title: 'Agreements signed', sub_weight: 2, due_date: '2026-08-21', completed_date: '2026-08-25' },
        { title: 'First order placed', sub_weight: 1, due_date: '2026-08-28', completed_date: '2026-08-27' },
      ],
      source: 'manual', state: 'submitted',
      comment: 'Agreements slipped by four days — one dealer delayed signing.',
      evidence: [{ filename: 'dealer-onboarding-tracker.txt', body: DEALER_TRACKER }],
      as_of: '2026-08-31',
    });
    full({
      employee_id: 1, period_id: 3, name: 'Client Communication',
      description: 'Quality and timeliness of client communication.',
      type: 'qualitative', weight: 25, reviewer_id: 5, approver_id: 7,
      rubric: RUBRIC,
      rubric_level: 4, source: 'manual', state: 'submitted',
      comment: 'Weekly updates sent to all key accounts; two escalations handled same-day.',
      evidence: [{ filename: 'client-feedback-summary.txt', body: CLIENT_FEEDBACK }],
    });

    // Nasrin — Production. Downtime is below target for the third period running.
    full({
      employee_id: 2, period_id: 3, name: 'Production Output', type: 'standard',
      target: 50_000, unit: 'units', weight: 40, reviewer_id: 6, approver_id: 7,
      actual: 47_500, source: 'system', source_detail: 'MES export, 01 Sep 2026',
      state: 'approved',
    });
    full({
      employee_id: 2, period_id: 3, name: 'Downtime Hours',
      description: 'Unplanned and planned line downtime. Lower is better.',
      type: 'inverse', target: 20, unit: 'hours', weight: 30,
      reviewer_id: 6, approver_id: 7,
      actual: 26, source: 'manual', state: 'approved',
      comment: 'Motor bearing failure on 09 Aug accounted for 9.5 hours.',
      evidence: [{ filename: 'downtime-log-august.txt', body: DOWNTIME_LOG }],
    });
    full({
      employee_id: 2, period_id: 3, name: 'Line Safety Compliance', type: 'qualitative',
      weight: 30, reviewer_id: 6, approver_id: 7, rubric: RUBRIC,
      rubric_level: 4, source: 'manual', state: 'approved',
      comment: 'No reportable incidents; two near-miss reports filed proactively.',
      evidence: [{ filename: 'safety-walkthrough-notes.txt', body: SAFETY_NOTES }],
    });

    // Tanvir — QC. Defect Rate at zero is the case that breaks target/actual:
    // it is a perfect result and would divide by zero under the naive formula.
    full({
      employee_id: 3, period_id: 3, name: 'Defect Rate',
      description: 'Rejected units as a share of output. Lower is better.',
      type: 'inverse', target: 2, unit: '%', weight: 50, reviewer_id: 6, approver_id: 7,
      actual: 0, source: 'system', source_detail: 'QC system export, 01 Sep 2026',
      state: 'approved',
    });
    full({
      employee_id: 3, period_id: 3, name: 'Inspection Coverage', type: 'standard',
      target: 100, unit: '%', weight: 30, reviewer_id: 6, approver_id: 7,
      actual: 96, source: 'system', source_detail: 'QC system export',
      state: 'under_review',
    });
    // Left pending on purpose: pending is not zero, and the dashboard must show it.
    full({
      employee_id: 3, period_id: 3, name: 'QC Documentation Quality', type: 'qualitative',
      weight: 20, reviewer_id: 6, approver_id: 7, rubric: RUBRIC, state: 'draft',
    });

    // Shirin — Supply Chain.
    full({
      employee_id: 4, period_id: 3, name: 'On-time Delivery', type: 'standard',
      target: 95, unit: '%', weight: 35, reviewer_id: 6, approver_id: 7,
      actual: 91, source: 'system', source_detail: 'Logistics export',
      state: 'submitted',
    });
    full({
      employee_id: 4, period_id: 3, name: 'Inventory Accuracy', type: 'standard',
      target: 98, unit: '%', weight: 25, reviewer_id: 6, approver_id: 7,
      actual: 98, source: 'system', source_detail: 'WMS cycle count',
      state: 'approved',
    });
    full({
      employee_id: 4, period_id: 3, name: 'Vendor Consolidation Project',
      type: 'milestone', weight: 40, reviewer_id: 6, approver_id: 7,
      milestones: [
        { title: 'Vendor spend analysis', sub_weight: 1, due_date: '2026-08-08', completed_date: '2026-08-08' },
        { title: 'Shortlist to 12 vendors', sub_weight: 2, due_date: '2026-08-18', completed_date: '2026-08-24' },
        { title: 'Renegotiate top 5 contracts', sub_weight: 2, due_date: '2026-08-29', completed_date: null },
      ],
      // Reviewed already, so the approval queue is not empty on a fresh install.
      source: 'manual', state: 'under_review',
      comment: 'Contract renegotiation carried into September.',
      evidence: [{ filename: 'vendor-consolidation-status.txt', body: VENDOR_STATUS }],
      as_of: '2026-08-31',
    });

    // Sample evidence files the demo can attach without needing a real upload.
    conn.prepare(
      `CREATE TABLE IF NOT EXISTS sample_evidence (
         id INTEGER PRIMARY KEY, filename TEXT NOT NULL, label TEXT NOT NULL, body TEXT NOT NULL)`,
    ).run();
    const sample = conn.prepare(
      `INSERT INTO sample_evidence (filename, label, body) VALUES (?,?,?)`,
    );
    sample.run(
      'august-sales-report.txt',
      'August Sales Report (as circulated 01 Sep)',
      SALES_REPORT_MISMATCH,
    );
    sample.run(
      'august-sales-report-final.txt',
      'August Sales Report — FINAL (reconciled)',
      SALES_REPORT_MATCH,
    );
  });

  tx();
}

/** Create an assignment plus, where applicable, its actual, evidence, score and audit events. */
function full(spec: RecordSpec) {
  const conn = db();
  const ts = now();

  const assignment = conn
    .prepare(
      `INSERT INTO kpi_assignment
       (employee_id, period_id, name, description, type, target, unit, weight,
        reviewer_id, approver_id, state, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      spec.employee_id, spec.period_id, spec.name, spec.description ?? null, spec.type,
      spec.target ?? null, spec.unit ?? null, spec.weight,
      spec.reviewer_id, spec.approver_id, spec.state, ts,
    );
  const kpiId = Number(assignment.lastInsertRowid);

  event(kpiId, spec.reviewer_id, 'assign', null, ts);

  if (spec.rubric) {
    const ins = conn.prepare(
      `INSERT INTO rubric_level (kpi_assignment_id, level, label, criteria_text, achievement_pct)
       VALUES (?,?,?,?,?)`,
    );
    for (const r of spec.rubric) ins.run(kpiId, r.level, r.label, r.criteria, r.pct);
  }

  if (spec.milestones) {
    const ins = conn.prepare(
      `INSERT INTO milestone (kpi_assignment_id, title, sub_weight, due_date, completed_date)
       VALUES (?,?,?,?,?)`,
    );
    for (const m of spec.milestones) ins.run(kpiId, m.title, m.sub_weight, m.due_date, m.completed_date);
  }

  if (spec.state === 'draft') return kpiId;

  // ---- actual entry ------------------------------------------------------
  const rubricPct = spec.rubric_level
    ? (spec.rubric ?? RUBRIC).find((r) => r.level === spec.rubric_level)?.pct ?? null
    : null;

  const entry = conn
    .prepare(
      `INSERT INTO actual_entry
       (kpi_assignment_id, value, rubric_level, source, source_detail, comment, reported_by, reported_at)
       VALUES (?,?,?,?,?,?,?,?)`,
    )
    .run(
      kpiId, spec.actual ?? null, spec.rubric_level ?? null,
      spec.source ?? 'system', spec.source_detail ?? null, spec.comment ?? null,
      spec.employee_id, ts,
    );
  const entryId = Number(entry.lastInsertRowid);

  for (const ev of spec.evidence ?? []) {
    const ref = storeEvidenceFile(ev.filename, ev.body);
    conn
      .prepare(
        `INSERT INTO evidence (actual_entry_id, filename, file_ref, mime, uploaded_by, uploaded_at)
         VALUES (?,?,?,?,?,?)`,
      )
      .run(entryId, ev.filename, ref, 'text/plain', spec.employee_id, ts);
  }

  event(kpiId, spec.employee_id, 'submit', null, ts);

  // ---- score -------------------------------------------------------------
  const result = computeAchievement({
    type: spec.type,
    target: spec.target ?? null,
    actual: spec.actual ?? null,
    milestones: spec.milestones,
    rubric_pct: rubricPct,
    as_of: spec.as_of,
  });

  const scoreId = writeScore(kpiId, result, {
    type: spec.type, target: spec.target, actual: spec.actual,
    rubric_level: spec.rubric_level, milestones: spec.milestones,
  }, spec.employee_id);

  if (spec.state === 'under_review') {
    event(kpiId, spec.reviewer_id, 'review', null, ts);
  }

  if (spec.state === 'approved') {
    event(kpiId, spec.reviewer_id, 'review', null, ts);
    event(kpiId, spec.approver_id, 'approve', null, ts, null, scoreId);
    conn
      .prepare(`UPDATE kpi_assignment SET state='approved', locked_by=?, locked_at=? WHERE id=?`)
      .run(spec.approver_id, ts, kpiId);
  }

  return kpiId;
}

export function writeScore(
  kpiId: number,
  result: ReturnType<typeof computeAchievement>,
  inputs: unknown,
  actorId: number,
  opts?: { final_pct?: number; adjusted?: boolean; reason?: string },
): number {
  const conn = db();
  conn.prepare(`UPDATE score SET is_current=0 WHERE kpi_assignment_id=?`).run(kpiId);
  const row = conn
    .prepare(
      `INSERT INTO score
       (kpi_assignment_id, calculated_pct, final_pct, formula_version, formula,
        inputs_json, cap_applied, adjusted, reason, is_current, created_by, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,1,?,?)`,
    )
    .run(
      kpiId,
      result.achievement_pct,
      opts?.final_pct ?? result.achievement_pct,
      FORMULA_VERSION,
      result.formula,
      JSON.stringify(inputs),
      result.cap_applied ? 1 : 0,
      opts?.adjusted ? 1 : 0,
      opts?.reason ?? null,
      actorId,
      now(),
    );
  return Number(row.lastInsertRowid);
}

export function event(
  kpiId: number,
  actorId: number,
  action: string,
  reason: string | null,
  at = now(),
  prevScoreId: number | null = null,
  newScoreId: number | null = null,
) {
  db()
    .prepare(
      `INSERT INTO review_event (kpi_assignment_id, actor_id, action, reason, prev_score_id, new_score_id, at)
       VALUES (?,?,?,?,?,?,?)`,
    )
    .run(kpiId, actorId, action, reason, prevScoreId, newScoreId, at);
}

const RUBRIC = [
  { level: 5, label: 'Outstanding', criteria: 'Consistently exceeds the standard; sets the example others follow.', pct: 100 },
  { level: 4, label: 'Strong', criteria: 'Meets the standard reliably and exceeds it in several instances.', pct: 85 },
  { level: 3, label: 'Meets expectations', criteria: 'Meets the agreed standard with no material gaps.', pct: 70 },
  { level: 2, label: 'Partially meets', criteria: 'Meets the standard inconsistently; needs follow-up.', pct: 50 },
  { level: 1, label: 'Below standard', criteria: 'Does not meet the agreed standard; improvement plan required.', pct: 25 },
];

const DEALER_TRACKER = `ANWAR GROUP — New Dealer Onboarding Tracker
Territory: Consumer Division | Owner: Rafiq Ahmed | Period: August 2026

Milestone                     Due          Completed    Status
Shortlist candidates          2026-08-07   2026-08-06   On time
Credit checks complete        2026-08-14   2026-08-13   On time
Agreements signed             2026-08-21   2026-08-25   LATE (4 days)
First order placed            2026-08-28   2026-08-27   On time

Note: Chattogram dealer delayed signing pending board approval.
`;

const CLIENT_FEEDBACK = `ANWAR GROUP — Key Account Feedback Summary
Period: August 2026 | Account owner: Rafiq Ahmed

- Weekly written updates issued to all 6 key accounts, without exception.
- Two escalations (Dhaka South pricing query, Sylhet delivery delay) were
  acknowledged and resolved within the same working day.
- One account noted that a revised quotation arrived a day later than promised.
- No complaints escalated to the Sales Manager this period.
`;

const SAFETY_NOTES = `ANWAR GROUP — Line Safety Walkthrough Notes
Line PL-02 | Period: August 2026 | Supervisor: Nasrin Sultana

- Zero reportable incidents this period.
- Two near-miss reports filed proactively (conveyor guard, spill response).
- Toolbox talks held weekly; attendance 96%.
- Outstanding: replacement guard for the packing station still on order.
`;

const VENDOR_STATUS = `ANWAR GROUP — Vendor Consolidation Project Status
Owner: Shirin Akter | Period: August 2026

Vendor spend analysis            Due 2026-08-08   Completed 2026-08-08
Shortlist to 12 vendors          Due 2026-08-18   Completed 2026-08-24  (LATE)
Renegotiate top 5 contracts      Due 2026-08-29   NOT COMPLETE

Two of five contract renegotiations are in legal review and will
carry into September.
`;

import { db } from './db';
import { computeAchievement, computeWeightedTotal, type KpiType, type Milestone } from './scoring';
import { latestSuggestion, type Suggestion } from './ai';

export type State = 'draft' | 'submitted' | 'under_review' | 'returned' | 'approved' | 'corrected';

export type Period = {
  id: number;
  label: string;
  type: string;
  start_date: string;
  end_date: string;
  status: 'open' | 'closed';
};

export type EvidenceFile = {
  id: number;
  filename: string;
  file_ref: string;
  mime: string;
  uploaded_at: string;
};

export type RubricLevel = {
  level: number;
  label: string;
  criteria_text: string;
  achievement_pct: number;
};

export type ScoreRow = {
  id: number;
  calculated_pct: number | null;
  final_pct: number | null;
  formula: string;
  formula_version: string;
  cap_applied: number;
  adjusted: number;
  reason: string | null;
  created_at: string;
  created_by_name: string | null;
};

export type AuditEntry = {
  id: number;
  action: string;
  reason: string | null;
  at: string;
  actor_name: string;
  actor_role: string;
  prev_pct: number | null;
  new_pct: number | null;
};

/** The one object every screen renders. Carries all five answers the brief demands. */
export type KpiRecord = {
  id: number;
  name: string;
  description: string | null;
  type: KpiType;
  target: number | null;
  unit: string | null;
  weight: number;
  state: State;
  period: Period;
  employee: { id: number; name: string; title: string; dept: string | null };
  reviewer: { id: number; name: string };
  approver: { id: number; name: string };
  locked_by_name: string | null;
  locked_at: string | null;

  actual: number | null;
  rubric_level: number | null;
  source: 'system' | 'manual' | null;
  source_detail: string | null;
  comment: string | null;
  reported_at: string | null;

  evidence: EvidenceFile[];
  rubric: RubricLevel[];
  milestones: Milestone[];

  score: ScoreRow | null;
  score_history: ScoreRow[];
  achievement_pct: number | null;
  pending: boolean;
  formula: string;
  cap_applied: boolean;

  ai: Suggestion | null;
};

export function periods(): Period[] {
  return db().prepare(`SELECT * FROM period ORDER BY id`).all() as Period[];
}

export function currentPeriod(): Period {
  return db().prepare(`SELECT * FROM period WHERE status='open' ORDER BY id DESC LIMIT 1`).get() as Period;
}

export function getRecord(id: number): KpiRecord | null {
  const conn = db();
  const k = conn
    .prepare(
      `SELECT a.*, e.name AS emp_name, e.title AS emp_title, d.name AS dept_name,
              r.name AS reviewer_name, ap.name AS approver_name, lk.name AS locked_by_name
       FROM kpi_assignment a
       JOIN employee e ON e.id = a.employee_id
       LEFT JOIN department d ON d.id = e.dept_id
       JOIN employee r ON r.id = a.reviewer_id
       JOIN employee ap ON ap.id = a.approver_id
       LEFT JOIN employee lk ON lk.id = a.locked_by
       WHERE a.id = ?`,
    )
    .get(id) as Record<string, unknown> | undefined;
  if (!k) return null;

  const period = conn.prepare(`SELECT * FROM period WHERE id = ?`).get(k.period_id) as Period;

  const entry = conn
    .prepare(`SELECT * FROM actual_entry WHERE kpi_assignment_id = ? ORDER BY id DESC LIMIT 1`)
    .get(id) as Record<string, unknown> | undefined;

  const evidence = entry
    ? (conn
        .prepare(
          `SELECT id, filename, file_ref, mime, uploaded_at FROM evidence
           WHERE actual_entry_id = ? ORDER BY id`,
        )
        .all(entry.id) as EvidenceFile[])
    : [];

  const rubric = conn
    .prepare(
      `SELECT level, label, criteria_text, achievement_pct FROM rubric_level
       WHERE kpi_assignment_id = ? ORDER BY level DESC`,
    )
    .all(id) as RubricLevel[];

  const milestones = conn
    .prepare(
      `SELECT title, sub_weight, due_date, completed_date FROM milestone
       WHERE kpi_assignment_id = ? ORDER BY due_date`,
    )
    .all(id) as Milestone[];

  const history = conn
    .prepare(
      `SELECT s.id, s.calculated_pct, s.final_pct, s.formula, s.formula_version,
              s.cap_applied, s.adjusted, s.reason, s.created_at, e.name AS created_by_name
       FROM score s LEFT JOIN employee e ON e.id = s.created_by
       WHERE s.kpi_assignment_id = ? ORDER BY s.id DESC`,
    )
    .all(id) as ScoreRow[];

  const current = history.find((h) => h.final_pct !== null || h.calculated_pct !== null) ?? history[0] ?? null;

  const rubricPct = entry?.rubric_level
    ? rubric.find((r) => r.level === entry.rubric_level)?.achievement_pct ?? null
    : null;

  const computed = computeAchievement({
    type: k.type as KpiType,
    target: (k.target as number) ?? null,
    actual: (entry?.value as number) ?? null,
    milestones,
    rubric_pct: rubricPct,
    as_of: period.end_date,
  });

  return {
    id: k.id as number,
    name: k.name as string,
    description: (k.description as string) ?? null,
    type: k.type as KpiType,
    target: (k.target as number) ?? null,
    unit: (k.unit as string) ?? null,
    weight: k.weight as number,
    state: k.state as State,
    period,
    employee: {
      id: k.employee_id as number,
      name: k.emp_name as string,
      title: k.emp_title as string,
      dept: (k.dept_name as string) ?? null,
    },
    reviewer: { id: k.reviewer_id as number, name: k.reviewer_name as string },
    approver: { id: k.approver_id as number, name: k.approver_name as string },
    locked_by_name: (k.locked_by_name as string) ?? null,
    locked_at: (k.locked_at as string) ?? null,

    actual: (entry?.value as number) ?? null,
    rubric_level: (entry?.rubric_level as number) ?? null,
    source: (entry?.source as 'system' | 'manual') ?? null,
    source_detail: (entry?.source_detail as string) ?? null,
    comment: (entry?.comment as string) ?? null,
    reported_at: (entry?.reported_at as string) ?? null,

    evidence,
    rubric,
    milestones,

    score: current,
    score_history: history,
    achievement_pct: current?.final_pct ?? computed.achievement_pct,
    pending: current ? current.final_pct === null : computed.pending,
    formula: current?.formula ?? computed.formula,
    cap_applied: current ? current.cap_applied === 1 : computed.cap_applied,

    ai: latestSuggestion(id),
  };
}

function idsWhere(sql: string, params: unknown[]): KpiRecord[] {
  const rows = db().prepare(sql).all(...params) as { id: number }[];
  return rows.map((r) => getRecord(r.id)).filter((r): r is KpiRecord => r !== null);
}

export function recordsForEmployee(employeeId: number, periodId: number): KpiRecord[] {
  return idsWhere(
    `SELECT id FROM kpi_assignment WHERE employee_id = ? AND period_id = ? ORDER BY id`,
    [employeeId, periodId],
  );
}

/** Manager review queue: submitted or already under review, routed to this reviewer. */
export function reviewQueue(reviewerId: number): KpiRecord[] {
  return idsWhere(
    `SELECT id FROM kpi_assignment
     WHERE reviewer_id = ? AND state IN ('submitted','under_review') ORDER BY id`,
    [reviewerId],
  );
}

/** Approval queue: reviewed and routed to this approver. */
export function approvalQueue(approverId: number): KpiRecord[] {
  return idsWhere(
    `SELECT id FROM kpi_assignment WHERE approver_id = ? AND state = 'under_review' ORDER BY id`,
    [approverId],
  );
}

/**
 * A record with a complete chain — target through to a lock — for the overview
 * hero. The page leads with a real, finished measurement rather than a welcome.
 */
export function completedRecord(periodId: number): KpiRecord | null {
  const row = db()
    .prepare(
      `SELECT a.id FROM kpi_assignment a
       JOIN score s ON s.kpi_assignment_id = a.id AND s.is_current = 1
       WHERE a.period_id = ? AND a.state IN ('approved','corrected') AND s.final_pct IS NOT NULL
       ORDER BY a.locked_at DESC LIMIT 1`,
    )
    .get(periodId) as { id: number } | undefined;
  return row ? getRecord(row.id) : null;
}

export function auditTrail(kpiId: number): AuditEntry[] {
  return db()
    .prepare(
      `SELECT r.id, r.action, r.reason, r.at, e.name AS actor_name, e.role AS actor_role,
              ps.final_pct AS prev_pct, ns.final_pct AS new_pct
       FROM review_event r
       JOIN employee e ON e.id = r.actor_id
       LEFT JOIN score ps ON ps.id = r.prev_score_id
       LEFT JOIN score ns ON ns.id = r.new_score_id
       WHERE r.kpi_assignment_id = ? ORDER BY r.id`,
    )
    .all(kpiId) as AuditEntry[];
}

export function employeeTotal(employeeId: number, periodId: number) {
  const records = recordsForEmployee(employeeId, periodId);
  return {
    records,
    total: computeWeightedTotal(
      records.map((r) => ({ achievement_pct: r.achievement_pct, weight: r.weight })),
    ),
  };
}

export function employees(): { id: number; name: string; title: string; dept: string | null }[] {
  return db()
    .prepare(
      `SELECT e.id, e.name, e.title, d.name AS dept FROM employee e
       LEFT JOIN department d ON d.id = e.dept_id
       WHERE e.role = 'employee' ORDER BY e.name`,
    )
    .all() as { id: number; name: string; title: string; dept: string | null }[];
}

// ---------------------------------------------------------------------------
// Dashboard
//
// Every figure below is computed on read from the same normalised tables, and
// every tile links through to the records underneath it. No summary store, and
// no number on the dashboard is a dead end.
// ---------------------------------------------------------------------------

export type Dashboard = {
  period: Period;
  evaluated: number;
  pending: number;
  totalRecords: number;
  avgScore: number | null;
  avgAchievement: number | null;
  departments: { name: string; business_unit: string; avg: number | null; records: number }[];
  belowTarget: { name: string; employee: string; periods: number }[];
  approvalsPending: number;
  adjustments: { kpi_id: number; kpi: string; employee: string; from: number | null; to: number | null; reason: string | null; by: string; at: string }[];
  trend: { label: string; avg: number | null }[];
};

export function dashboard(periodId: number): Dashboard {
  const conn = db();
  const period = conn.prepare(`SELECT * FROM period WHERE id = ?`).get(periodId) as Period;

  const all = idsWhere(`SELECT id FROM kpi_assignment WHERE period_id = ? ORDER BY id`, [periodId]);
  const scored = all.filter((r) => !r.pending);

  const avgAchievement = scored.length
    ? Math.round((scored.reduce((s, r) => s + (r.achievement_pct ?? 0), 0) / scored.length) * 10) / 10
    : null;

  // Employee-level: how many people have every KPI approved.
  const byEmployee = new Map<number, KpiRecord[]>();
  for (const r of all) {
    if (!byEmployee.has(r.employee.id)) byEmployee.set(r.employee.id, []);
    byEmployee.get(r.employee.id)!.push(r);
  }
  let evaluated = 0;
  let pendingEmployees = 0;
  const totals: number[] = [];
  for (const [empId, recs] of byEmployee) {
    if (recs.every((r) => r.state === 'approved')) evaluated += 1;
    else pendingEmployees += 1;
    const t = employeeTotal(empId, periodId).total;
    if (t.scored_weight > 0) totals.push((t.score / t.scored_weight) * 100);
  }
  const avgScore = totals.length
    ? Math.round((totals.reduce((s, n) => s + n, 0) / totals.length) * 10) / 10
    : null;

  // Departments
  const deptRows = conn.prepare(`SELECT name, business_unit FROM department ORDER BY name`).all() as {
    name: string;
    business_unit: string;
  }[];
  const departments = deptRows.map((d) => {
    const recs = scored.filter((r) => r.employee.dept === d.name);
    return {
      name: d.name,
      business_unit: d.business_unit,
      avg: recs.length
        ? Math.round((recs.reduce((s, r) => s + (r.achievement_pct ?? 0), 0) / recs.length) * 10) / 10
        : null,
      records: recs.length,
    };
  });

  // KPIs consistently below target: below 100% in 3+ consecutive periods.
  const belowRows = conn
    .prepare(
      `SELECT a.name, e.name AS employee, p.id AS period_id, s.final_pct
       FROM kpi_assignment a
       JOIN employee e ON e.id = a.employee_id
       JOIN period p ON p.id = a.period_id
       JOIN score s ON s.kpi_assignment_id = a.id AND s.is_current = 1
       WHERE s.final_pct IS NOT NULL
       ORDER BY a.name, e.name, p.id`,
    )
    .all() as { name: string; employee: string; period_id: number; final_pct: number }[];

  const streaks = new Map<string, { name: string; employee: string; periods: number }>();
  for (const row of belowRows) {
    const key = `${row.employee}::${row.name}`;
    if (!streaks.has(key)) streaks.set(key, { name: row.name, employee: row.employee, periods: 0 });
    const s = streaks.get(key)!;
    if (row.final_pct < 100) s.periods += 1;
    else s.periods = 0;
  }
  const belowTarget = [...streaks.values()].filter((s) => s.periods >= 3);

  const approvalsPending = (
    conn
      .prepare(
        `SELECT COUNT(*) AS n FROM kpi_assignment
         WHERE period_id = ? AND state IN ('submitted','under_review')`,
      )
      .get(periodId) as { n: number }
  ).n;

  const adjustments = conn
    .prepare(
      `SELECT a.id AS kpi_id, a.name AS kpi, emp.name AS employee,
              s.calculated_pct AS "from", s.final_pct AS "to", s.reason, act.name AS by, s.created_at AS at
       FROM score s
       JOIN kpi_assignment a ON a.id = s.kpi_assignment_id
       JOIN employee emp ON emp.id = a.employee_id
       LEFT JOIN employee act ON act.id = s.created_by
       WHERE s.adjusted = 1 AND a.period_id = ?
       ORDER BY s.id DESC`,
    )
    .all(periodId) as Dashboard['adjustments'];

  const trend = (conn.prepare(`SELECT * FROM period ORDER BY id`).all() as Period[]).map((p) => {
    const recs = idsWhere(`SELECT id FROM kpi_assignment WHERE period_id = ?`, [p.id]).filter(
      (r) => !r.pending,
    );
    return {
      label: p.label,
      avg: recs.length
        ? Math.round((recs.reduce((s, r) => s + (r.achievement_pct ?? 0), 0) / recs.length) * 10) / 10
        : null,
    };
  });

  return {
    period,
    evaluated,
    pending: pendingEmployees,
    totalRecords: all.length,
    avgScore,
    avgAchievement,
    departments,
    belowTarget,
    approvalsPending,
    adjustments,
    trend,
  };
}

export function sampleEvidence(): { id: number; filename: string; label: string }[] {
  try {
    return db().prepare(`SELECT id, filename, label FROM sample_evidence ORDER BY id`).all() as {
      id: number;
      filename: string;
      label: string;
    }[];
  } catch {
    return [];
  }
}

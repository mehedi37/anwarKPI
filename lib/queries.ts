import { all, one } from './db';
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

export async function periods(): Promise<Period[]> {
  return all<Period>(`SELECT * FROM period ORDER BY id`);
}

export async function currentPeriod(): Promise<Period> {
  return (await one<Period>(`SELECT * FROM period WHERE status='open' ORDER BY id DESC LIMIT 1`))!;
}

export async function getRecord(id: number): Promise<KpiRecord | null> {
  const k = await one<Record<string, unknown>>(
    `SELECT a.*, e.name AS emp_name, e.title AS emp_title, d.name AS dept_name,
            r.name AS reviewer_name, ap.name AS approver_name, lk.name AS locked_by_name
     FROM kpi_assignment a
     JOIN employee e ON e.id = a.employee_id
     LEFT JOIN department d ON d.id = e.dept_id
     JOIN employee r ON r.id = a.reviewer_id
     JOIN employee ap ON ap.id = a.approver_id
     LEFT JOIN employee lk ON lk.id = a.locked_by
     WHERE a.id = ?`,
    [id],
  );
  if (!k) return null;

  const period = (await one<Period>(`SELECT * FROM period WHERE id = ?`, [k.period_id]))!;

  const entry = await one<Record<string, unknown>>(
    `SELECT * FROM actual_entry WHERE kpi_assignment_id = ? ORDER BY id DESC LIMIT 1`,
    [id],
  );

  const evidence = entry
    ? await all<EvidenceFile>(
        `SELECT id, filename, file_ref, mime, uploaded_at FROM evidence
         WHERE actual_entry_id = ? ORDER BY id`,
        [entry.id],
      )
    : [];

  const rubric = await all<RubricLevel>(
    `SELECT level, label, criteria_text, achievement_pct FROM rubric_level
     WHERE kpi_assignment_id = ? ORDER BY level DESC`,
    [id],
  );

  const milestones = await all<Milestone>(
    `SELECT title, sub_weight, due_date, completed_date FROM milestone
     WHERE kpi_assignment_id = ? ORDER BY due_date`,
    [id],
  );

  const history = await all<ScoreRow>(
    `SELECT s.id, s.calculated_pct, s.final_pct, s.formula, s.formula_version,
            s.cap_applied, s.adjusted, s.reason, s.created_at, e.name AS created_by_name
     FROM score s LEFT JOIN employee e ON e.id = s.created_by
     WHERE s.kpi_assignment_id = ? ORDER BY s.id DESC`,
    [id],
  );

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

    ai: await latestSuggestion(id),
  };
}

async function idsWhere(sql: string, params: unknown[]): Promise<KpiRecord[]> {
  const rows = await all<{ id: number }>(sql, params);
  const records = await Promise.all(rows.map((r) => getRecord(r.id)));
  return records.filter((r): r is KpiRecord => r !== null);
}

export async function recordsForEmployee(employeeId: number, periodId: number): Promise<KpiRecord[]> {
  return idsWhere(
    `SELECT id FROM kpi_assignment WHERE employee_id = ? AND period_id = ? ORDER BY id`,
    [employeeId, periodId],
  );
}

/** Manager review queue: submitted or already under review, routed to this reviewer. */
export async function reviewQueue(reviewerId: number): Promise<KpiRecord[]> {
  return idsWhere(
    `SELECT id FROM kpi_assignment
     WHERE reviewer_id = ? AND state IN ('submitted','under_review') ORDER BY id`,
    [reviewerId],
  );
}

/** Approval queue: reviewed and routed to this approver. */
export async function approvalQueue(approverId: number): Promise<KpiRecord[]> {
  return idsWhere(
    `SELECT id FROM kpi_assignment WHERE approver_id = ? AND state = 'under_review' ORDER BY id`,
    [approverId],
  );
}

/**
 * A record with a complete chain — target through to a lock — for the overview
 * hero. The page leads with a real, finished measurement rather than a welcome.
 */
export async function completedRecord(periodId: number): Promise<KpiRecord | null> {
  const row = await one<{ id: number }>(
    `SELECT a.id FROM kpi_assignment a
     JOIN score s ON s.kpi_assignment_id = a.id AND s.is_current = 1
     WHERE a.period_id = ? AND a.state IN ('approved','corrected') AND s.final_pct IS NOT NULL
     ORDER BY a.locked_at DESC LIMIT 1`,
    [periodId],
  );
  return row ? getRecord(row.id) : null;
}

export async function auditTrail(kpiId: number): Promise<AuditEntry[]> {
  return all<AuditEntry>(
    `SELECT r.id, r.action, r.reason, r.at, e.name AS actor_name, e.role AS actor_role,
            ps.final_pct AS prev_pct, ns.final_pct AS new_pct
     FROM review_event r
     JOIN employee e ON e.id = r.actor_id
     LEFT JOIN score ps ON ps.id = r.prev_score_id
     LEFT JOIN score ns ON ns.id = r.new_score_id
     WHERE r.kpi_assignment_id = ? ORDER BY r.id`,
    [kpiId],
  );
}

export async function employeeTotal(employeeId: number, periodId: number) {
  const records = await recordsForEmployee(employeeId, periodId);
  return {
    records,
    total: computeWeightedTotal(
      records.map((r) => ({ achievement_pct: r.achievement_pct, weight: r.weight })),
    ),
  };
}

export async function employees(): Promise<{ id: number; name: string; title: string; dept: string | null }[]> {
  return all<{ id: number; name: string; title: string; dept: string | null }>(
    `SELECT e.id, e.name, e.title, d.name AS dept FROM employee e
     LEFT JOIN department d ON d.id = e.dept_id
     WHERE e.role = 'employee' ORDER BY e.name`,
  );
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

export async function dashboard(periodId: number): Promise<Dashboard> {
  const period = (await one<Period>(`SELECT * FROM period WHERE id = ?`, [periodId]))!;

  const allRecords = await idsWhere(`SELECT id FROM kpi_assignment WHERE period_id = ? ORDER BY id`, [periodId]);
  const scored = allRecords.filter((r) => !r.pending);

  const avgAchievement = scored.length
    ? Math.round((scored.reduce((s, r) => s + (r.achievement_pct ?? 0), 0) / scored.length) * 10) / 10
    : null;

  // Employee-level: how many people have every KPI approved.
  const byEmployee = new Map<number, KpiRecord[]>();
  for (const r of allRecords) {
    if (!byEmployee.has(r.employee.id)) byEmployee.set(r.employee.id, []);
    byEmployee.get(r.employee.id)!.push(r);
  }
  let evaluated = 0;
  let pendingEmployees = 0;
  const totals: number[] = [];
  for (const [empId, recs] of byEmployee) {
    if (recs.every((r) => r.state === 'approved')) evaluated += 1;
    else pendingEmployees += 1;
    const t = (await employeeTotal(empId, periodId)).total;
    if (t.scored_weight > 0) totals.push((t.score / t.scored_weight) * 100);
  }
  const avgScore = totals.length
    ? Math.round((totals.reduce((s, n) => s + n, 0) / totals.length) * 10) / 10
    : null;

  // Departments
  const deptRows = await all<{ name: string; business_unit: string }>(
    `SELECT name, business_unit FROM department ORDER BY name`,
  );
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
  const belowRows = await all<{ name: string; employee: string; period_id: number; final_pct: number }>(
    `SELECT a.name, e.name AS employee, p.id AS period_id, s.final_pct
     FROM kpi_assignment a
     JOIN employee e ON e.id = a.employee_id
     JOIN period p ON p.id = a.period_id
     JOIN score s ON s.kpi_assignment_id = a.id AND s.is_current = 1
     WHERE s.final_pct IS NOT NULL
     ORDER BY a.name, e.name, p.id`,
  );

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
    await one<{ n: number }>(
      `SELECT COUNT(*) AS n FROM kpi_assignment
       WHERE period_id = ? AND state IN ('submitted','under_review')`,
      [periodId],
    )
  )!.n;

  const adjustments = await all<Dashboard['adjustments'][number]>(
    `SELECT a.id AS kpi_id, a.name AS kpi, emp.name AS employee,
            s.calculated_pct AS "from", s.final_pct AS "to", s.reason, act.name AS by, s.created_at AS at
     FROM score s
     JOIN kpi_assignment a ON a.id = s.kpi_assignment_id
     JOIN employee emp ON emp.id = a.employee_id
     LEFT JOIN employee act ON act.id = s.created_by
     WHERE s.adjusted = 1 AND a.period_id = ?
     ORDER BY s.id DESC`,
    [periodId],
  );

  const allPeriods = await all<Period>(`SELECT * FROM period ORDER BY id`);
  const trend = await Promise.all(
    allPeriods.map(async (p) => {
      const recs = (await idsWhere(`SELECT id FROM kpi_assignment WHERE period_id = ?`, [p.id])).filter(
        (r) => !r.pending,
      );
      return {
        label: p.label,
        avg: recs.length
          ? Math.round((recs.reduce((s, r) => s + (r.achievement_pct ?? 0), 0) / recs.length) * 10) / 10
          : null,
      };
    }),
  );

  return {
    period,
    evaluated,
    pending: pendingEmployees,
    totalRecords: allRecords.length,
    avgScore,
    avgAchievement,
    departments,
    belowTarget,
    approvalsPending,
    adjustments,
    trend,
  };
}

export async function sampleEvidence(): Promise<{ id: number; filename: string; label: string }[]> {
  try {
    return await all<{ id: number; filename: string; label: string }>(
      `SELECT id, filename, label FROM sample_evidence ORDER BY id`,
    );
  } catch {
    return [];
  }
}

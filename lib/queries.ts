import { all, one } from './db';
import { computeAchievement, computeWeightedTotal, type KpiType, type Milestone } from './scoring';
import type { Suggestion } from './ai';

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

type CombinedRecordRow = {
  id: number; name: string; description: string | null; type: KpiType;
  target: number | null; unit: string | null; weight: number; state: State;
  employee_id: number; reviewer_id: number; approver_id: number;
  emp_name: string; emp_title: string; dept_name: string | null;
  reviewer_name: string; approver_name: string; locked_by_name: string | null;
  locked_by: number | null; locked_at: string | null;
  period: Period;
  entry: {
    id: number; value: number | null; rubric_level: number | null;
    source: 'system' | 'manual'; source_detail: string | null;
    comment: string | null; reported_at: string;
  } | null;
  rubric: RubricLevel[];
  milestones: Milestone[];
  history: ScoreRow[];
  evidence: EvidenceFile[];
  ai: Suggestion | null;
};

/**
 * One round trip instead of ~7: LATERAL joins + json_agg assemble the record
 * plus every related collection (period, entry, rubric, milestones, score
 * history, evidence, AI suggestion) in a single query. Each of those was a
 * separate query before, and this runs once per row on every list/dashboard
 * page, so the round-trip count multiplies fast under real network latency.
 */
export async function getRecord(id: number): Promise<KpiRecord | null> {
  const row = await one<CombinedRecordRow>(
    `SELECT
       a.id, a.name, a.description, a.type, a.target, a.unit, a.weight, a.state,
       a.employee_id, a.reviewer_id, a.approver_id,
       e.name AS emp_name, e.title AS emp_title, d.name AS dept_name,
       r.name AS reviewer_name, ap.name AS approver_name, lk.name AS locked_by_name,
       a.locked_by, a.locked_at,

       row_to_json(p.*) AS period,
       row_to_json(entry.*) AS entry,

       COALESCE(rubric_agg.rubric, '[]') AS rubric,
       COALESCE(milestone_agg.milestones, '[]') AS milestones,
       COALESCE(history_agg.history, '[]') AS history,
       COALESCE(evidence_agg.evidence, '[]') AS evidence,
       row_to_json(ai.*) AS ai

     FROM kpi_assignment a
     JOIN employee e ON e.id = a.employee_id
     LEFT JOIN department d ON d.id = e.dept_id
     JOIN employee r ON r.id = a.reviewer_id
     JOIN employee ap ON ap.id = a.approver_id
     LEFT JOIN employee lk ON lk.id = a.locked_by
     JOIN period p ON p.id = a.period_id

     LEFT JOIN LATERAL (
       SELECT * FROM actual_entry WHERE kpi_assignment_id = a.id ORDER BY id DESC LIMIT 1
     ) entry ON true

     LEFT JOIN LATERAL (
       SELECT json_agg(json_build_object(
                'level', level, 'label', label,
                'criteria_text', criteria_text, 'achievement_pct', achievement_pct
              ) ORDER BY level DESC) AS rubric
       FROM rubric_level WHERE kpi_assignment_id = a.id
     ) rubric_agg ON true

     LEFT JOIN LATERAL (
       SELECT json_agg(json_build_object(
                'title', title, 'sub_weight', sub_weight,
                'due_date', due_date, 'completed_date', completed_date
              ) ORDER BY due_date) AS milestones
       FROM milestone WHERE kpi_assignment_id = a.id
     ) milestone_agg ON true

     LEFT JOIN LATERAL (
       SELECT json_agg(json_build_object(
                'id', s.id, 'calculated_pct', s.calculated_pct, 'final_pct', s.final_pct,
                'formula', s.formula, 'formula_version', s.formula_version,
                'cap_applied', s.cap_applied, 'adjusted', s.adjusted, 'reason', s.reason,
                'created_at', s.created_at, 'created_by_name', emp2.name
              ) ORDER BY s.id DESC) AS history
       FROM score s LEFT JOIN employee emp2 ON emp2.id = s.created_by
       WHERE s.kpi_assignment_id = a.id
     ) history_agg ON true

     LEFT JOIN LATERAL (
       SELECT json_agg(json_build_object(
                'id', ev.id, 'filename', ev.filename, 'file_ref', ev.file_ref,
                'mime', ev.mime, 'uploaded_at', ev.uploaded_at
              ) ORDER BY ev.id) AS evidence
       FROM evidence ev WHERE entry.id IS NOT NULL AND ev.actual_entry_id = entry.id
     ) evidence_agg ON true

     LEFT JOIN LATERAL (
       SELECT s2.id, s2.status, s2.extracted_value, s2.claimed_value, s2.rationale,
              s2.model_id, s2.created_at, s2.resolution, emp3.name AS resolved_by_name
       FROM ai_suggestion s2
       LEFT JOIN employee emp3 ON emp3.id = s2.resolved_by
       WHERE s2.kpi_assignment_id = a.id ORDER BY s2.id DESC LIMIT 1
     ) ai ON true

     WHERE a.id = ?`,
    [id],
  );
  if (!row) return null;

  const { period, entry, rubric, milestones, history, evidence, ai } = row;

  const current = history.find((h) => h.final_pct !== null || h.calculated_pct !== null) ?? history[0] ?? null;

  const rubricPct = entry?.rubric_level
    ? rubric.find((r) => r.level === entry.rubric_level)?.achievement_pct ?? null
    : null;

  const computed = computeAchievement({
    type: row.type,
    target: row.target ?? null,
    actual: entry?.value ?? null,
    milestones,
    rubric_pct: rubricPct,
    as_of: period.end_date,
  });

  return {
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    type: row.type,
    target: row.target ?? null,
    unit: row.unit ?? null,
    weight: row.weight,
    state: row.state,
    period,
    employee: {
      id: row.employee_id,
      name: row.emp_name,
      title: row.emp_title,
      dept: row.dept_name ?? null,
    },
    reviewer: { id: row.reviewer_id, name: row.reviewer_name },
    approver: { id: row.approver_id, name: row.approver_name },
    locked_by_name: row.locked_by_name ?? null,
    locked_at: row.locked_at ?? null,

    actual: entry?.value ?? null,
    rubric_level: entry?.rubric_level ?? null,
    source: entry?.source ?? null,
    source_detail: entry?.source_detail ?? null,
    comment: entry?.comment ?? null,
    reported_at: entry?.reported_at ?? null,

    evidence,
    rubric,
    milestones,

    score: current,
    score_history: history,
    achievement_pct: current?.final_pct ?? computed.achievement_pct,
    pending: current ? current.final_pct === null : computed.pending,
    formula: current?.formula ?? computed.formula,
    cap_applied: current ? current.cap_applied === 1 : computed.cap_applied,

    ai,
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
  // None of these depend on each other's results — only the JS computed
  // below depends on them — so they run as one batch of round trips instead
  // of six sequential ones.
  const [period, allRecords, deptRows, belowRows, approvalsPendingRow, adjustments, allPeriods] = await Promise.all([
    one<Period>(`SELECT * FROM period WHERE id = ?`, [periodId]),
    idsWhere(`SELECT id FROM kpi_assignment WHERE period_id = ? ORDER BY id`, [periodId]),
    all<{ name: string; business_unit: string }>(`SELECT name, business_unit FROM department ORDER BY name`),
    all<{ name: string; employee: string; period_id: number; final_pct: number }>(
      `SELECT a.name, e.name AS employee, p.id AS period_id, s.final_pct
       FROM kpi_assignment a
       JOIN employee e ON e.id = a.employee_id
       JOIN period p ON p.id = a.period_id
       JOIN score s ON s.kpi_assignment_id = a.id AND s.is_current = 1
       WHERE s.final_pct IS NOT NULL
       ORDER BY a.name, e.name, p.id`,
    ),
    one<{ n: number }>(
      `SELECT COUNT(*) AS n FROM kpi_assignment WHERE period_id = ? AND state IN ('submitted','under_review')`,
      [periodId],
    ),
    all<Dashboard['adjustments'][number]>(
      `SELECT a.id AS kpi_id, a.name AS kpi, emp.name AS employee,
              s.calculated_pct AS "from", s.final_pct AS "to", s.reason, act.name AS by, s.created_at AS at
       FROM score s
       JOIN kpi_assignment a ON a.id = s.kpi_assignment_id
       JOIN employee emp ON emp.id = a.employee_id
       LEFT JOIN employee act ON act.id = s.created_by
       WHERE s.adjusted = 1 AND a.period_id = ?
       ORDER BY s.id DESC`,
      [periodId],
    ),
    all<Period>(`SELECT * FROM period ORDER BY id`),
  ]);
  const approvalsPending = approvalsPendingRow!.n;

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
  for (const recs of byEmployee.values()) {
    if (recs.every((r) => r.state === 'approved')) evaluated += 1;
    else pendingEmployees += 1;
    // Reuses the records already fetched into `allRecords` above, rather
    // than calling employeeTotal() and re-fetching the same rows again.
    const t = computeWeightedTotal(recs.map((r) => ({ achievement_pct: r.achievement_pct, weight: r.weight })));
    if (t.scored_weight > 0) totals.push((t.score / t.scored_weight) * 100);
  }
  const avgScore = totals.length
    ? Math.round((totals.reduce((s, n) => s + n, 0) / totals.length) * 10) / 10
    : null;

  // Departments
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
  const streaks = new Map<string, { name: string; employee: string; periods: number }>();
  for (const row of belowRows) {
    const key = `${row.employee}::${row.name}`;
    if (!streaks.has(key)) streaks.set(key, { name: row.name, employee: row.employee, periods: 0 });
    const s = streaks.get(key)!;
    if (row.final_pct < 100) s.periods += 1;
    else s.periods = 0;
  }
  const belowTarget = [...streaks.values()].filter((s) => s.periods >= 3);

  const trend = await Promise.all(
    allPeriods.map(async (p) => {
      // Reuse allRecords for the period already fetched above instead of
      // fetching the same full records over again.
      const recs = (p.id === periodId ? allRecords : await idsWhere(`SELECT id FROM kpi_assignment WHERE period_id = ?`, [p.id])).filter(
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
    period: period!,
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

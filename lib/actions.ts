'use server';

import fs from 'node:fs';
import path from 'node:path';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { db, now, EVIDENCE_DIR, DATA_DIR, closeDb } from './db';
import { currentUser, CAN } from './session';
import { computeAchievement, validateWeights, type KpiType } from './scoring';
import { writeScore, event, seed } from './seed';
import { verifyEvidence } from './ai';
import { storeEvidenceFile } from './evidence';
import { getRecord } from './queries';

function revalidateAll() {
  for (const p of ['/', '/setup', '/my-kpis', '/review', '/approve', '/summary', '/dashboard']) {
    revalidatePath(p, 'page');
  }
  revalidatePath('/kpi/[id]', 'page');
}

/**
 * Validation failures in this system are deliberate rules, not crashes:
 * "manual entries require evidence", "a reason is required", "this record is
 * locked". Next.js redacts thrown server-action messages in production, so a
 * rejection is sent back to the originating screen as a readable message
 * instead of an error code.
 */
function fail(path: string, message: string): never {
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}

export async function switchUser(formData: FormData) {
  const id = String(formData.get('uid') ?? '1');
  (await cookies()).set('uid', id, { path: '/', httpOnly: false, sameSite: 'lax' });
  revalidateAll();
}

/** Recompute from stored inputs and write a NEW score row. Never updates in place. */
function recalculate(kpiId: number, actorId: number) {
  const rec = getRecord(kpiId);
  if (!rec) return null;

  const rubricPct = rec.rubric_level
    ? rec.rubric.find((r) => r.level === rec.rubric_level)?.achievement_pct ?? null
    : null;

  const result = computeAchievement({
    type: rec.type,
    target: rec.target,
    actual: rec.actual,
    milestones: rec.milestones,
    rubric_pct: rubricPct,
    as_of: rec.period.end_date,
  });

  return writeScore(
    kpiId,
    result,
    { type: rec.type, target: rec.target, actual: rec.actual, rubric_level: rec.rubric_level, milestones: rec.milestones },
    actorId,
  );
}

/**
 * Step 2 + 3 of the demo flow: actual entered, evidence attached.
 *
 * The provenance rule is enforced here, not in the UI alone: a manual entry
 * without an attachment is rejected. That single validation is what turns
 * "evidence-based" from a claim into a property of the system.
 */
export async function submitActual(formData: FormData) {
  const user = await currentUser();
  const kpiId = Number(formData.get('kpi_id'));
  const rec = getRecord(kpiId);
  if (!rec) fail('/my-kpis', 'That KPI could not be found.');

  const back = `/kpi/${kpiId}/submit`;
  if (!CAN.enterActual(user)) fail(back, 'Your role cannot enter results. Switch to the employee who owns this KPI.');
  if (user.role === 'employee' && user.id !== rec.employee.id) fail(back, 'You can only record results for your own KPIs.');
  if (user.role === 'manager' && user.id !== rec.reviewer.id) fail(back, 'You are not the manager routed to this KPI.');
  if (rec.state === 'approved') fail(back, 'This record is locked. Approved scores are changed only through the HR correction process.');

  const conn = db();
  const source = (String(formData.get('source') ?? 'manual') === 'system' ? 'system' : 'manual') as
    | 'system'
    | 'manual';
  const comment = String(formData.get('comment') ?? '').trim() || null;

  let value: number | null = null;
  let rubricLevel: number | null = null;

  if (rec.type === 'qualitative') {
    const lvl = formData.get('rubric_level');
    if (!lvl) fail(back, 'Select a rubric level before submitting.');
    rubricLevel = Number(lvl);
  } else if (rec.type === 'milestone') {
    // Milestone completion is captured on the milestone rows themselves.
    // Rows are read in the same order the form renders them, so the inputs are
    // addressed by position rather than by database id.
    const ids = conn
      .prepare(`SELECT id FROM milestone WHERE kpi_assignment_id = ? ORDER BY due_date`)
      .all(kpiId) as { id: number }[];
    const upd = conn.prepare(`UPDATE milestone SET completed_date = ? WHERE id = ?`);
    ids.forEach((m, i) => {
      const d = String(formData.get(`ms_${i + 1}`) ?? '').trim();
      upd.run(d || null, m.id);
    });
  } else {
    const raw = String(formData.get('value') ?? '').trim();
    if (raw === '') fail(back, 'Enter the actual result before submitting.');
    value = Number(raw);
    if (!Number.isFinite(value)) fail(back, 'The actual result must be a number.');
  }

  // Collect attachments before writing, so validation can fail cleanly.
  const uploads = formData.getAll('evidence').filter((f): f is File => f instanceof File && f.size > 0);
  const sampleIds = formData
    .getAll('sample_evidence')
    .map((s) => Number(s))
    .filter((n) => Number.isFinite(n) && n > 0);

  if (source === 'manual' && uploads.length === 0 && sampleIds.length === 0) {
    fail(back, 'Manual entries require supporting evidence. Attach a document before submitting — this is a hard rule, not a reminder.');
  }

  const entryId = Number(
    conn
      .prepare(
        `INSERT INTO actual_entry
         (kpi_assignment_id, value, rubric_level, source, source_detail, comment, reported_by, reported_at)
         VALUES (?,?,?,?,?,?,?,?)`,
      )
      .run(
        kpiId, value, rubricLevel, source,
        source === 'system' ? String(formData.get('source_detail') ?? 'System export') : null,
        comment, user.id, now(),
      ).lastInsertRowid,
  );

  const insEvidence = conn.prepare(
    `INSERT INTO evidence (actual_entry_id, filename, file_ref, mime, uploaded_by, uploaded_at)
     VALUES (?,?,?,?,?,?)`,
  );

  for (const file of uploads) {
    // file.name is attacker controlled — storeEvidenceFile sanitises it.
    const ref = storeEvidenceFile(file.name, Buffer.from(await file.arrayBuffer()));
    insEvidence.run(entryId, file.name, ref, file.type || 'application/octet-stream', user.id, now());
  }

  for (const sid of sampleIds) {
    const s = conn.prepare(`SELECT filename, body FROM sample_evidence WHERE id = ?`).get(sid) as
      | { filename: string; body: string }
      | undefined;
    if (!s) continue;
    const ref = storeEvidenceFile(s.filename, s.body);
    insEvidence.run(entryId, s.filename, ref, 'text/plain', user.id, now());
  }

  event(kpiId, user.id, 'submit', comment, now());
  recalculate(kpiId, user.id); // step 4: score calculated
  conn.prepare(`UPDATE kpi_assignment SET state='submitted' WHERE id=?`).run(kpiId);

  await verifyEvidence(kpiId); // AI writes to ai_suggestion only

  revalidateAll();
  redirect(`/kpi/${kpiId}`);
}

export async function startReview(formData: FormData) {
  const user = await currentUser();
  const kpiId = Number(formData.get('kpi_id'));
  if (!CAN.review(user)) fail(`/kpi/${kpiId}`, 'Your role cannot review records.');

  const rec = getRecord(kpiId);
  if (!rec) fail('/review', 'That KPI could not be found.');
  if (user.id !== rec.reviewer.id && user.id !== rec.approver.id) {
    fail(`/kpi/${kpiId}`, 'You are not the reviewer or approver routed to this record.');
  }

  db().prepare(`UPDATE kpi_assignment SET state='under_review' WHERE id=? AND state='submitted'`).run(kpiId);
  event(kpiId, user.id, 'review', null, now());
  revalidateAll();
  redirect(`/kpi/${kpiId}`);
}

export async function returnForClarification(formData: FormData) {
  const user = await currentUser();
  const kpiId = Number(formData.get('kpi_id'));
  const reason = String(formData.get('reason') ?? '').trim();
  if (!CAN.review(user)) fail(`/kpi/${kpiId}`, 'Your role cannot review records.');
  if (!reason) fail(`/kpi/${kpiId}`, 'A written reason is required when returning a record for clarification.');

  const rec = getRecord(kpiId);
  if (!rec) fail('/review', 'That KPI could not be found.');
  if (user.id !== rec.reviewer.id && user.id !== rec.approver.id) {
    fail(`/kpi/${kpiId}`, 'You are not the reviewer or approver routed to this record.');
  }

  db().prepare(`UPDATE kpi_assignment SET state='returned' WHERE id=?`).run(kpiId);
  event(kpiId, user.id, 'return', reason, now());
  revalidateAll();
  redirect(`/kpi/${kpiId}`);
}

/**
 * Manual adjustment. A reason is mandatory, and the original calculated score
 * is preserved on the new score row rather than replaced.
 */
export async function adjustScore(formData: FormData) {
  const user = await currentUser();
  const kpiId = Number(formData.get('kpi_id'));
  const reason = String(formData.get('reason') ?? '').trim();
  const pct = Number(formData.get('final_pct'));

  if (!CAN.adjust(user)) fail(`/kpi/${kpiId}`, 'Your role cannot adjust scores.');
  if (!reason) fail(`/kpi/${kpiId}`, 'A written reason is required for every manual adjustment. This is what makes the audit trail worth having.');
  if (!Number.isFinite(pct)) fail(`/kpi/${kpiId}`, 'Enter the adjusted achievement %.');

  const rec = getRecord(kpiId);
  if (!rec) fail('/review', 'That KPI could not be found.');
  if (user.id !== rec.reviewer.id && user.id !== rec.approver.id) {
    fail(`/kpi/${kpiId}`, 'You are not the reviewer or approver routed to this record.');
  }
  if (rec.state === 'approved') fail(`/kpi/${kpiId}`, 'This record is locked. Use the authorised HR correction process.');

  const prevScoreId = rec.score?.id ?? null;
  const rubricPct = rec.rubric_level
    ? rec.rubric.find((r) => r.level === rec.rubric_level)?.achievement_pct ?? null
    : null;

  const recomputed = computeAchievement({
    type: rec.type, target: rec.target, actual: rec.actual,
    milestones: rec.milestones, rubric_pct: rubricPct, as_of: rec.period.end_date,
  });

  const newScoreId = writeScore(
    kpiId,
    recomputed,
    { type: rec.type, target: rec.target, actual: rec.actual, rubric_level: rec.rubric_level },
    user.id,
    { final_pct: pct, adjusted: true, reason },
  );

  event(kpiId, user.id, 'adjust', reason, now(), prevScoreId, newScoreId);
  revalidateAll();
  redirect(`/kpi/${kpiId}`);
}

/** Final approval locks the record. There is no edit path after this. */
export async function approve(formData: FormData) {
  const user = await currentUser();
  const kpiId = Number(formData.get('kpi_id'));
  if (!CAN.approve(user)) fail(`/kpi/${kpiId}`, 'Only an approver can give final approval. Switch to Mahbub Rahman.');

  const rec = getRecord(kpiId);
  if (!rec) fail('/approve', 'That KPI could not be found.');
  if (user.id !== rec.approver.id) fail(`/kpi/${kpiId}`, 'You are not the approver routed to this record.');
  if (rec.pending) fail(`/kpi/${kpiId}`, 'This KPI has no recorded result yet, so there is nothing to approve.');

  db()
    .prepare(`UPDATE kpi_assignment SET state='approved', locked_by=?, locked_at=? WHERE id=?`)
    .run(user.id, now(), kpiId);
  event(kpiId, user.id, 'approve', null, now(), null, rec.score?.id ?? null);
  revalidateAll();
  redirect(`/kpi/${kpiId}`);
}

/**
 * The authorised correction process — the only way past the lock, and HR-only.
 * It does not edit the approved score; it writes a further version linked to it.
 */
export async function correct(formData: FormData) {
  const user = await currentUser();
  const kpiId = Number(formData.get('kpi_id'));
  const reason = String(formData.get('reason') ?? '').trim();
  const pct = Number(formData.get('final_pct'));

  if (!CAN.correct(user)) fail(`/kpi/${kpiId}`, 'Only HR can correct an approved record. This is deliberate: corrections are a controlled process, not a privilege of seniority.');
  if (!reason) fail(`/kpi/${kpiId}`, 'A written reason is required for a correction.');
  if (!Number.isFinite(pct)) fail(`/kpi/${kpiId}`, 'Enter the corrected achievement %.');

  const rec = getRecord(kpiId);
  if (!rec) fail('/dashboard', 'That KPI could not be found.');
  if (rec.state !== 'approved' && rec.state !== 'corrected') {
    fail(`/kpi/${kpiId}`, 'Corrections apply only to approved records.');
  }

  const prevScoreId = rec.score?.id ?? null;
  const rubricPct = rec.rubric_level
    ? rec.rubric.find((r) => r.level === rec.rubric_level)?.achievement_pct ?? null
    : null;
  const recomputed = computeAchievement({
    type: rec.type, target: rec.target, actual: rec.actual,
    milestones: rec.milestones, rubric_pct: rubricPct, as_of: rec.period.end_date,
  });

  const newScoreId = writeScore(
    kpiId, recomputed,
    { type: rec.type, target: rec.target, actual: rec.actual, rubric_level: rec.rubric_level },
    user.id,
    { final_pct: pct, adjusted: true, reason: `CORRECTION: ${reason}` },
  );

  db()
    .prepare(`UPDATE kpi_assignment SET state='corrected', locked_by=?, locked_at=? WHERE id=?`)
    .run(user.id, now(), kpiId);
  event(kpiId, user.id, 'correct', reason, now(), prevScoreId, newScoreId);
  revalidateAll();
  redirect(`/kpi/${kpiId}`);
}

/** Accepting or overriding an AI flag is itself a logged review event. */
export async function resolveSuggestion(formData: FormData) {
  const user = await currentUser();
  const kpiId = Number(formData.get('kpi_id'));
  const suggestionId = Number(formData.get('suggestion_id'));
  const resolution = String(formData.get('resolution')) === 'accepted' ? 'accepted' : 'overridden';

  db()
    .prepare(`UPDATE ai_suggestion SET resolution=?, resolved_by=?, resolved_at=? WHERE id=?`)
    .run(resolution, user.id, now(), suggestionId);
  event(
    kpiId, user.id, resolution === 'accepted' ? 'ai_accept' : 'ai_override',
    resolution === 'accepted'
      ? 'Reviewer accepted the evidence-check finding'
      : 'Reviewer overrode the evidence-check finding',
    now(),
  );
  revalidateAll();
  redirect(`/kpi/${kpiId}`);
}

export async function createKpi(formData: FormData) {
  const user = await currentUser();
  if (!CAN.setupKpi(user)) fail('/setup', 'Your role cannot set up KPIs.');

  const conn = db();
  const employee_id = Number(formData.get('employee_id'));
  const period_id = Number(formData.get('period_id'));
  const type = String(formData.get('type')) as KpiType;
  const weight = Number(formData.get('weight'));
  const name = String(formData.get('name') ?? '').trim();
  const target = formData.get('target') ? Number(formData.get('target')) : null;

  if (!name) fail('/setup', 'A KPI name is required.');
  if (!Number.isFinite(weight) || weight <= 0) fail('/setup', 'Weight must be a positive number.');
  if ((type === 'standard' || type === 'inverse') && (!target || target === 0)) {
    fail(
      '/setup',
      'A non-zero target is required. A zero target means this should be a milestone or qualitative KPI instead.',
    );
  }

  const existing = conn
    .prepare(`SELECT weight FROM kpi_assignment WHERE employee_id=? AND period_id=?`)
    .all(employee_id, period_id) as { weight: number }[];
  const check = validateWeights([...existing.map((e) => e.weight), weight]);
  if (check.total > 100) {
    fail('/setup', `Weights for this employee would total ${check.total}%. They must not exceed 100%.`);
  }

  const kpiId = Number(
    conn
      .prepare(
        `INSERT INTO kpi_assignment
         (employee_id, period_id, name, description, type, target, unit, weight,
          reviewer_id, approver_id, state, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?, 'draft', ?)`,
      )
      .run(
        employee_id, period_id, name,
        String(formData.get('description') ?? '').trim() || null,
        type, target, String(formData.get('unit') ?? '').trim() || null, weight,
        Number(formData.get('reviewer_id')), Number(formData.get('approver_id')), now(),
      ).lastInsertRowid,
  );

  if (type === 'qualitative') {
    const ins = conn.prepare(
      `INSERT INTO rubric_level (kpi_assignment_id, level, label, criteria_text, achievement_pct)
       VALUES (?,?,?,?,?)`,
    );
    for (const r of [
      { level: 5, label: 'Outstanding', criteria: 'Consistently exceeds the standard; sets the example others follow.', pct: 100 },
      { level: 4, label: 'Strong', criteria: 'Meets the standard reliably and exceeds it in several instances.', pct: 85 },
      { level: 3, label: 'Meets expectations', criteria: 'Meets the agreed standard with no material gaps.', pct: 70 },
      { level: 2, label: 'Partially meets', criteria: 'Meets the standard inconsistently; needs follow-up.', pct: 50 },
      { level: 1, label: 'Below standard', criteria: 'Does not meet the agreed standard; improvement plan required.', pct: 25 },
    ]) {
      ins.run(kpiId, r.level, r.label, r.criteria, r.pct);
    }
  }

  if (type === 'milestone') {
    const ins = conn.prepare(
      `INSERT INTO milestone (kpi_assignment_id, title, sub_weight, due_date, completed_date)
       VALUES (?,?,?,?,NULL)`,
    );
    for (let i = 1; i <= 4; i++) {
      const t = String(formData.get(`ms_title_${i}`) ?? '').trim();
      const d = String(formData.get(`ms_due_${i}`) ?? '').trim();
      const w = Number(formData.get(`ms_weight_${i}`) ?? 1);
      if (t && d) ins.run(kpiId, t, Number.isFinite(w) && w > 0 ? w : 1, d);
    }
  }

  event(kpiId, user.id, 'assign', null, now());
  revalidateAll();
  redirect(`/kpi/${kpiId}`);
}

/** Reset to the seeded demo state. Used before recording a walkthrough. */
export async function resetDemo() {
  closeDb();
  try {
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  seed();
  revalidateAll();
  redirect('/');
}

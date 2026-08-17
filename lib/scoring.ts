/**
 * KPIFlow scoring engine.
 *
 * Pure functions, no I/O. Every score the system shows comes from here, and
 * every score row stores the FORMULA_VERSION plus its inputs so a historical
 * score can be recomputed and explained even after these rules change.
 */

export const FORMULA_VERSION = 'v1';
export const CAP_PCT = 120;
export const FLOOR_PCT = 0;

export type KpiType = 'standard' | 'inverse' | 'milestone' | 'qualitative';

export type Milestone = {
  title: string;
  sub_weight: number;
  due_date: string; // ISO date
  completed_date: string | null;
};

export type ScoreInput = {
  type: KpiType;
  target: number | null;
  actual: number | null;
  milestones?: Milestone[];
  /** Achievement % that the selected rubric level maps to. */
  rubric_pct?: number | null;
  /** Evaluate milestone KPIs as of this date. Defaults to today. */
  as_of?: string;
};

export type ScoreResult = {
  /** null when the KPI is pending — pending is NOT zero. */
  achievement_pct: number | null;
  /** Before cap/floor were applied. */
  raw_pct: number | null;
  cap_applied: boolean;
  floor_applied: boolean;
  pending: boolean;
  /** Human-readable derivation, shown in the UI and stored on the score row. */
  formula: string;
};

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Achievement % for a single KPI.
 *
 * The four types exist because the brief asks for them explicitly. The cap and
 * floor exist because without them one outlier KPI distorts the weighted total:
 * an inverse KPI at 4x its target returns -200% uncapped, which would wipe out
 * an employee's whole score from a single line.
 */
export function computeAchievement(input: ScoreInput): ScoreResult {
  const pending = (raw_pct: null = null): ScoreResult => ({
    achievement_pct: null,
    raw_pct,
    cap_applied: false,
    floor_applied: false,
    pending: true,
    formula: 'Pending — no result recorded yet',
  });

  let raw: number;
  let formula: string;

  switch (input.type) {
    case 'standard': {
      if (input.actual === null || input.actual === undefined) return pending();
      if (!input.target) throw new Error('standard KPI requires a non-zero target');
      raw = (input.actual / input.target) * 100;
      formula = `${fmt(input.actual)} ÷ ${fmt(input.target)} × 100`;
      break;
    }

    case 'inverse': {
      // Lower is better. NOT target/actual — that divides by zero on a perfect
      // result (zero defects), which is the single most likely outcome to break
      // a defect-rate KPI. This form is linear and handles actual = 0 as 200%.
      if (input.actual === null || input.actual === undefined) return pending();
      if (!input.target) throw new Error('inverse KPI requires a non-zero target');
      raw = (2 - input.actual / input.target) * 100;
      formula = `(2 − ${fmt(input.actual)} ÷ ${fmt(input.target)}) × 100`;
      break;
    }

    case 'milestone': {
      const all = input.milestones ?? [];
      const asOf = input.as_of ?? new Date().toISOString().slice(0, 10);
      const due = all.filter((m) => m.due_date <= asOf);
      if (due.length === 0) return pending();

      const dueWeight = due.reduce((s, m) => s + m.sub_weight, 0);
      const onTime = due.filter((m) => m.completed_date && m.completed_date <= m.due_date);
      const earned = onTime.reduce((s, m) => s + m.sub_weight, 0);

      raw = (earned / dueWeight) * 100;
      formula = `${onTime.length} of ${due.length} milestones on time (weight ${earned}/${dueWeight})`;
      break;
    }

    case 'qualitative': {
      if (input.rubric_pct === null || input.rubric_pct === undefined) return pending();
      raw = input.rubric_pct;
      formula = `Rubric level → ${raw}%`;
      break;
    }
  }

  const capped = Math.min(raw, CAP_PCT);
  const floored = Math.max(capped, FLOOR_PCT);

  return {
    achievement_pct: round1(floored),
    raw_pct: round1(raw),
    cap_applied: raw > CAP_PCT,
    floor_applied: capped < FLOOR_PCT,
    pending: false,
    formula,
  };
}

export type WeightedLine = {
  achievement_pct: number | null;
  weight: number;
};

export type WeightedTotal = {
  /** Weighted points earned so far, out of `scored_weight`. */
  score: number;
  /** Weight of the KPIs that actually have a result. */
  scored_weight: number;
  /** Weight of everything assigned, scored or not. */
  total_weight: number;
  pending_count: number;
};

/**
 * Weighted total for one employee-period.
 *
 * Pending KPIs are EXCLUDED, not counted as zero. Treating them as zero makes
 * every dashboard report a fake collapse at the start of each period.
 */
export function computeWeightedTotal(lines: WeightedLine[]): WeightedTotal {
  let score = 0;
  let scored_weight = 0;
  let total_weight = 0;
  let pending_count = 0;

  for (const line of lines) {
    total_weight += line.weight;
    if (line.achievement_pct === null) {
      pending_count += 1;
      continue;
    }
    score += (line.achievement_pct * line.weight) / 100;
    scored_weight += line.weight;
  }

  return {
    score: round1(score),
    scored_weight,
    total_weight,
    pending_count,
  };
}

/** Setup-time validation. Weights must sum to 100 per employee per period. */
export function validateWeights(weights: number[]): { ok: boolean; total: number } {
  const total = weights.reduce((s, w) => s + w, 0);
  return { ok: total === 100, total };
}

/** A measurement with its unit, spaced the way each unit is actually written. */
export function formatValue(v: number | null, unit: string | null): string {
  if (v === null) return '—';
  if (unit === 'BDT') return `BDT ${fmt(v)}`;
  if (unit === '%') return `${fmt(v)}%`;
  return unit ? `${fmt(v)} ${unit}` : fmt(v);
}

export function fmt(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

/** Achievement % -> the band used for colour and wording in the UI. */
export function band(pct: number | null): 'pending' | 'below' | 'met' | 'exceeded' {
  if (pct === null) return 'pending';
  if (pct < 100) return 'below';
  if (pct === 100) return 'met';
  return 'exceeded';
}

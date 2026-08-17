/**
 * Scoring engine checks. Run with: npm test
 *
 * These cover the cases that actually break a KPI scoring engine — the ones
 * worth naming in the submission, not the happy path.
 */
import assert from 'node:assert/strict';
import { computeAchievement, computeWeightedTotal, validateWeights } from '../lib/scoring.ts';

let passed = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (err) {
    console.error(`  FAIL ${name}\n       ${(err as Error).message}`);
    process.exitCode = 1;
  }
}

console.log('\nStandard (higher is better)');
check('the brief\'s own example: 9m against a 10m target is 90%', () => {
  const r = computeAchievement({ type: 'standard', target: 10_000_000, actual: 9_000_000 });
  assert.equal(r.achievement_pct, 90);
  assert.equal(r.pending, false);
});
check('exceeding the target is capped at 120%, and says so', () => {
  const r = computeAchievement({ type: 'standard', target: 100, actual: 400 });
  assert.equal(r.achievement_pct, 120);
  assert.equal(r.raw_pct, 400);
  assert.equal(r.cap_applied, true);
});

console.log('\nInverse (lower is better)');
check('hitting the target exactly scores 100%', () => {
  assert.equal(computeAchievement({ type: 'inverse', target: 5, actual: 5 }).achievement_pct, 100);
});
check('beating the target scores above 100%', () => {
  assert.equal(computeAchievement({ type: 'inverse', target: 5, actual: 3 }).achievement_pct, 120);
});
check('a PERFECT result of zero does not divide by zero', () => {
  // This is the case target/actual gets wrong: zero defects is the best
  // possible outcome and would crash or return Infinity.
  const r = computeAchievement({ type: 'inverse', target: 2, actual: 0 });
  assert.equal(r.raw_pct, 200);
  assert.equal(r.achievement_pct, 120);
  assert.ok(Number.isFinite(r.raw_pct!));
});
check('a bad overshoot floors at 0%, never negative', () => {
  const r = computeAchievement({ type: 'inverse', target: 5, actual: 20 });
  assert.equal(r.raw_pct, -200);
  assert.equal(r.achievement_pct, 0);
});
check('equal misses either side of target cost the same', () => {
  const under = computeAchievement({ type: 'inverse', target: 10, actual: 8 }).achievement_pct!;
  const over = computeAchievement({ type: 'inverse', target: 10, actual: 12 }).achievement_pct!;
  assert.equal(under - 100, 100 - over);
});
check('a zero target is rejected rather than silently handled', () => {
  assert.throws(() => computeAchievement({ type: 'inverse', target: 0, actual: 1 }));
});

console.log('\nMilestone');
check('scores on the weight delivered on time, out of the weight due', () => {
  const r = computeAchievement({
    type: 'milestone',
    target: null,
    actual: null,
    as_of: '2026-08-31',
    milestones: [
      { title: 'a', sub_weight: 1, due_date: '2026-08-07', completed_date: '2026-08-06' },
      { title: 'b', sub_weight: 1, due_date: '2026-08-14', completed_date: '2026-08-13' },
      { title: 'c', sub_weight: 2, due_date: '2026-08-21', completed_date: '2026-08-25' }, // late
      { title: 'd', sub_weight: 1, due_date: '2026-08-28', completed_date: '2026-08-27' },
    ],
  });
  assert.equal(r.achievement_pct, 60); // 3 of 5 weight on time
});
check('milestones not yet due are excluded, not counted as missed', () => {
  const r = computeAchievement({
    type: 'milestone',
    target: null,
    actual: null,
    as_of: '2026-08-10',
    milestones: [
      { title: 'a', sub_weight: 1, due_date: '2026-08-07', completed_date: '2026-08-06' },
      { title: 'b', sub_weight: 3, due_date: '2026-09-30', completed_date: null },
    ],
  });
  assert.equal(r.achievement_pct, 100);
});
check('a KPI whose milestones are all in the future is pending', () => {
  const r = computeAchievement({
    type: 'milestone',
    target: null,
    actual: null,
    as_of: '2026-08-01',
    milestones: [{ title: 'a', sub_weight: 1, due_date: '2026-09-30', completed_date: null }],
  });
  assert.equal(r.pending, true);
  assert.equal(r.achievement_pct, null);
});

console.log('\nQualitative');
check('a rubric level maps to a fixed percentage, not a band', () => {
  assert.equal(computeAchievement({ type: 'qualitative', target: null, actual: null, rubric_pct: 85 }).achievement_pct, 85);
});
check('no level selected is pending, not zero', () => {
  const r = computeAchievement({ type: 'qualitative', target: null, actual: null, rubric_pct: null });
  assert.equal(r.pending, true);
  assert.equal(r.achievement_pct, null);
});

console.log('\nWeighted total');
check('weights the brief\'s example correctly', () => {
  const t = computeWeightedTotal([
    { achievement_pct: 90, weight: 30 },
    { achievement_pct: 100, weight: 70 },
  ]);
  assert.equal(t.score, 97);
  assert.equal(t.scored_weight, 100);
});
check('PENDING IS NOT ZERO — it is excluded from the total', () => {
  const t = computeWeightedTotal([
    { achievement_pct: 90, weight: 30 },
    { achievement_pct: null, weight: 70 },
  ]);
  assert.equal(t.score, 27);
  assert.equal(t.scored_weight, 30); // scored out of 30, not out of 100
  assert.equal(t.pending_count, 1);
  // The distinction that matters: 27/30 = 90%, not 27/100 = 27%.
  assert.equal(Math.round((t.score / t.scored_weight) * 100), 90);
});
check('one capped outlier cannot dominate the total', () => {
  const t = computeWeightedTotal([
    { achievement_pct: 120, weight: 50 },
    { achievement_pct: 0, weight: 50 },
  ]);
  assert.equal(t.score, 60);
});

console.log('\nSetup validation');
check('weights must total exactly 100', () => {
  assert.equal(validateWeights([30, 20, 25, 25]).ok, true);
  assert.equal(validateWeights([30, 20, 25]).ok, false);
  assert.equal(validateWeights([50, 60]).ok, false);
});

console.log(`\n${passed} checks passed${process.exitCode ? ' — WITH FAILURES' : ''}\n`);

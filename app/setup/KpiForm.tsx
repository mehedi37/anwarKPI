'use client';

import { useState } from 'react';
import { createKpi } from '@/lib/actions';
import { Button, Card, Field, inputCls } from '@/components/ui';

type Person = { id: number; name: string; title: string; dept: string | null };
type Reviewer = { id: number; name: string; role: string };
type Period = { id: number; label: string; status: string };

export function KpiForm({
  staff,
  reviewers,
  approvers,
  periods,
  usedWeight,
}: {
  staff: Person[];
  reviewers: Reviewer[];
  approvers: Reviewer[];
  periods: Period[];
  /** employeeId -> periodId -> weight already assigned */
  usedWeight: Record<string, number>;
}) {
  const openPeriod = periods.find((p) => p.status === 'open') ?? periods[periods.length - 1];

  const [employeeId, setEmployeeId] = useState(String(staff[0]?.id ?? ''));
  const [periodId, setPeriodId] = useState(String(openPeriod?.id ?? ''));
  const [type, setType] = useState<'standard' | 'inverse' | 'milestone' | 'qualitative'>('standard');
  const [weight, setWeight] = useState(10);

  const used = usedWeight[`${employeeId}:${periodId}`] ?? 0;
  const after = used + (Number.isFinite(weight) ? weight : 0);
  const remaining = 100 - used;

  const weightTone =
    after > 100 ? 'text-dev' : after === 100 ? 'text-datum' : 'text-signal';

  return (
    <form action={createKpi} className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <div className="space-y-4">
        <Card className="p-5">
          <h2 className="mb-4 font-semibold text-ink">Who and when</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Employee">
              <select
                name="employee_id"
                value={employeeId}
                onChange={(e) => setEmployeeId(e.target.value)}
                className={inputCls}
              >
                {staff.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} — {s.dept}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Reporting period" hint="Target and weight are fixed once the period opens.">
              <select
                name="period_id"
                value={periodId}
                onChange={(e) => setPeriodId(e.target.value)}
                className={inputCls}
              >
                {periods.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label} {p.status === 'closed' ? '(closed)' : ''}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Reviewer">
              <select name="reviewer_id" className={inputCls} defaultValue={reviewers[0]?.id}>
                {reviewers.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Approver">
              <select name="approver_id" className={inputCls} defaultValue={approvers[0]?.id}>
                {approvers.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="mb-4 font-semibold text-ink">The KPI</h2>
          <div className="grid gap-4">
            <Field label="KPI name">
              <input name="name" required placeholder="e.g. Monthly Sales" className={inputCls} />
            </Field>
            <Field label="Description (optional)">
              <input
                name="description"
                placeholder="What this measures and why it matters."
                className={inputCls}
              />
            </Field>

            <Field label="KPI type" hint="Determines the scoring formula.">
              <div className="grid gap-2 sm:grid-cols-2">
                {(
                  [
                    ['standard', 'Higher is better', 'Actual ÷ Target × 100'],
                    ['inverse', 'Lower is better', '(2 − Actual ÷ Target) × 100'],
                    ['milestone', 'Milestone-based', 'Weight of milestones on time'],
                    ['qualitative', 'Qualitative', 'Rubric level → fixed %'],
                  ] as const
                ).map(([val, label, formula]) => (
                  <label
                    key={val}
                    className={`flex cursor-pointer gap-2 border p-3 transition-colors ${
                      type === val
                        ? 'border-datum bg-datum-soft/50'
                        : 'border-rule hover:border-datum'
                    }`}
                  >
                    <input
                      type="radio"
                      name="type"
                      value={val}
                      checked={type === val}
                      onChange={() => setType(val)}
                      className="mt-1"
                    />
                    <span>
                      <span className="block text-sm font-semibold text-ink">{label}</span>
                      <span className="num block text-xs text-ink3">{formula}</span>
                    </span>
                  </label>
                ))}
              </div>
            </Field>

            {(type === 'standard' || type === 'inverse') && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Target"
                  hint="Must be non-zero. A zero target means this should be a milestone or qualitative KPI."
                >
                  <input name="target" type="number" step="any" required className={inputCls} />
                </Field>
                <Field label="Unit">
                  <input name="unit" placeholder="BDT, units, %, hours" className={inputCls} />
                </Field>
              </div>
            )}

            {type === 'qualitative' && (
              <div className="border border-rule bg-ground p-3 text-sm text-ink2">
                A five-level rubric with written criteria is created automatically, each level mapped to a
                fixed achievement % (100 / 85 / 70 / 50 / 25). Fixed percentages rather than bands — a band
                puts the reviewer discretion back that the rubric exists to remove.
              </div>
            )}

            {type === 'milestone' && (
              <div className="border border-rule p-3">
                <p className="mb-3 text-sm text-ink2">
                  Each milestone carries its own sub-weight. The KPI scores on the weight delivered on time,
                  out of the weight due in the period.
                </p>
                <div className="space-y-2">
                  {[1, 2, 3, 4].map((i) => (
                    <div key={i} className="grid gap-2 sm:grid-cols-[1fr_6rem_10rem]">
                      <input
                        name={`ms_title_${i}`}
                        placeholder={`Milestone ${i}`}
                        className={inputCls}
                      />
                      <input
                        name={`ms_weight_${i}`}
                        type="number"
                        min="1"
                        defaultValue="1"
                        className={inputCls}
                      />
                      <input name={`ms_due_${i}`} type="date" className={inputCls} />
                    </div>
                  ))}
                </div>
              </div>
            )}

            <Field label="Weight (%)" hint="Weights across an employee's KPIs must total 100% for the period.">
              <input
                name="weight"
                type="number"
                min="1"
                max="100"
                required
                value={weight}
                onChange={(e) => setWeight(Number(e.target.value))}
                className={inputCls}
              />
            </Field>
          </div>
        </Card>

        <div className="flex justify-end">
          <Button type="submit" variant="primary" disabled={after > 100}>
            Assign KPI
          </Button>
        </div>
      </div>

      <aside className="space-y-4">
        <Card className="p-4">
          <h3 className="text-sm font-semibold text-ink">Weight check</h3>
          <p className="mt-1 text-sm text-ink2">
            Already assigned for this employee and period:{' '}
            <strong className="num text-ink">{used}%</strong>
          </p>
          <p className={`num mt-3 text-3xl font-bold ${weightTone}`}>{after}%</p>
          <p className="mt-1 text-sm text-ink2">after adding this KPI</p>
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-ground">
            <div
              className={`h-full ${after > 100 ? 'bg-dev-soft' : after === 100 ? 'bg-datum' : 'bg-signal-soft'}`}
              style={{ width: `${Math.min(after, 100)}%` }}
            />
          </div>
          <p className="mt-3 text-sm">
            {after > 100 ? (
              <span className="font-semibold text-dev">
                Over by {after - 100}%. Reduce the weight before assigning.
              </span>
            ) : after === 100 ? (
              <span className="font-semibold text-datum">Complete — weights total exactly 100%.</span>
            ) : (
              <span className="font-semibold text-signal">
                {100 - after}% still unallocated after this KPI. {remaining}% is available now.
              </span>
            )}
          </p>
        </Card>

      </aside>
    </form>
  );
}

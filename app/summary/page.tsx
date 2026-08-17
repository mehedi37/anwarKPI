import Link from 'next/link';
import { currentPeriod, employeeTotal, employees, periods } from '@/lib/queries';
import { currentUser } from '@/lib/session';
import { fmt } from '@/lib/scoring';
import { Card, Empty, Measure, PageHeader, Pct, StateBadge, ToleranceRail } from '@/components/ui';

function pctOf(score: number, weight: number) {
  return weight > 0 ? Math.round((score / weight) * 1000) / 10 : null;
}

export default async function SummaryPage({
  searchParams,
}: {
  searchParams: Promise<{ employee?: string; period?: string }>;
}) {
  const user = await currentUser();
  const sp = await searchParams;
  const all = periods();
  const staff = employees();

  const employeeId =
    user.role === 'employee' ? user.id : Number(sp.employee ?? staff[0]?.id ?? user.id);
  const period = all.find((p) => String(p.id) === sp.period) ?? currentPeriod();
  const prev = all.filter((p) => p.id < period.id).at(-1) ?? null;

  const { records, total } = employeeTotal(employeeId, period.id);
  const prevTotal = prev ? employeeTotal(employeeId, prev.id).total : null;

  const current = pctOf(total.score, total.scored_weight);
  const previous = prevTotal ? pctOf(prevTotal.score, prevTotal.scored_weight) : null;
  const delta = current !== null && previous !== null ? Math.round((current - previous) * 10) / 10 : null;

  const person = staff.find((s) => s.id === employeeId);

  return (
    <>
      <PageHeader
        eyebrow={period.label}
        title={person ? person.name : user.name}
        lead={person ? `${person.title} · ${person.dept}` : undefined}
      >
        <div className="flex flex-wrap gap-2">
          {user.role !== 'employee' && (
            <form className="flex gap-1">
              <input type="hidden" name="period" value={period.id} />
              <select
                name="employee"
                defaultValue={String(employeeId)}
                className="border border-rule bg-white px-2.5 py-1.5 text-sm"
              >
                {staff.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <button className="border border-rule bg-white px-3 py-1.5 text-sm font-semibold">
                Show
              </button>
            </form>
          )}
          <div className="flex gap-1">
            {all.map((p) => (
              <Link
                key={p.id}
                href={`/summary?employee=${employeeId}&period=${p.id}`}
                className={`border px-3 py-1.5 text-sm font-medium ${
                  p.id === period.id
                    ? 'border-datum bg-datum-soft text-datum'
                    : 'border-rule bg-white text-ink2 hover:bg-ground'
                }`}
              >
                {p.label}
              </Link>
            ))}
          </div>
        </div>
      </PageHeader>

      <div className="mb-6 grid gap-4 sm:grid-cols-4">
        <Measure
          label="total kpi score"
          value={current === null ? '—' : `${current}%`}
          rail={{ pct: current }}
          sub={`${total.score} points from ${total.scored_weight} weight`}
        />
        <Measure
          label={prev ? `change vs ${prev.label}` : 'previous period'}
          value={delta === null ? '—' : `${delta > 0 ? '+' : ''}${delta}`}
          sub={previous === null ? 'No comparable period' : `Was ${previous}%`}
          tone={delta === null ? 'ink' : delta >= 0 ? 'datum' : 'dev'}
        />
        <Measure label="kpis" value={records.length} sub={`${total.total_weight}% total weight`} />
        <Measure
          label="unmeasured"
          value={total.pending_count}
          sub="Excluded from the score"
          tone={total.pending_count > 0 ? 'signal' : 'datum'}
        />
      </div>

      {records.length === 0 ? (
        <Empty>No KPIs assigned for {period.label}.</Empty>
      ) : (
        <Card className="mb-6 overflow-x-auto">
          <table className="w-full min-w-[46rem] text-sm">
            <thead>
              <tr className="border-b border-rule bg-ground/70 text-left text-xs uppercase tracking-wide text-ink3">
                <th className="px-4 py-2.5 font-semibold">KPI</th>
                <th className="px-4 py-2.5 font-semibold">Target</th>
                <th className="px-4 py-2.5 font-semibold">Actual</th>
                <th className="px-4 py-2.5 font-semibold">Achievement</th>
                <th className="px-4 py-2.5 font-semibold">Weight</th>
                <th className="px-4 py-2.5 font-semibold">Points</th>
                <th className="px-4 py-2.5 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-rule2">
              {records.map((r) => (
                <tr key={r.id} className="hover:bg-ground/50">
                  <td className="px-4 py-3">
                    <Link href={`/kpi/${r.id}`} className="font-medium text-ink hover:text-datum">
                      {r.name}
                    </Link>
                  </td>
                  <td className="num px-4 py-3 text-ink2">
                    {r.type === 'milestone'
                      ? `${r.milestones.length} milestones`
                      : r.type === 'qualitative'
                        ? 'Rubric 1–5'
                        : `${fmt(r.target ?? 0)}${r.unit && r.unit !== 'BDT' ? ` ${r.unit}` : ''}`}
                  </td>
                  <td className="num px-4 py-3 text-ink2">
                    {r.type === 'milestone'
                      ? `${r.milestones.filter((m) => m.completed_date && m.completed_date <= m.due_date).length} on time`
                      : r.type === 'qualitative'
                        ? r.rubric_level
                          ? `Level ${r.rubric_level}`
                          : '—'
                        : r.actual === null
                          ? '—'
                          : fmt(r.actual)}
                  </td>
                  <td className="px-4 py-3">
                    <Pct value={r.achievement_pct} />
                    {r.cap_applied && <span className="ml-1 text-xs text-ink3">capped</span>}
                  </td>
                  <td className="num px-4 py-3 text-ink2">{r.weight}%</td>
                  <td className="num px-4 py-3 font-semibold text-ink">
                    {r.achievement_pct === null
                      ? '—'
                      : Math.round(((r.achievement_pct * r.weight) / 100) * 10) / 10}
                  </td>
                  <td className="px-4 py-3">
                    <StateBadge state={r.state} />
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-rule bg-ground/70 font-semibold">
                <td className="px-4 py-3" colSpan={4}>
                  Total
                </td>
                <td className="num px-4 py-3">{total.scored_weight}%</td>
                <td className="num px-4 py-3 text-ink">{total.score}</td>
                <td className="px-4 py-3" />
              </tr>
            </tfoot>
          </table>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="font-semibold text-ink">Why each score is what it is</h2>
          <p className="mt-1 text-sm text-ink3">
            Written from the record itself — the same five answers a reviewer sees.
          </p>
          <ul className="mt-3 space-y-3 text-sm">
            {records
              .filter((r) => !r.pending)
              .map((r) => (
                <li key={r.id} className="border-l-2 border-datum pl-3">
                  <p className="font-medium text-ink">{r.name}</p>
                  <p className="text-ink2">
                    {r.formula} = {r.achievement_pct}%
                    {r.cap_applied && ' (capped at 120%)'}, weighted at {r.weight}% ={' '}
                    {Math.round(((r.achievement_pct! * r.weight) / 100) * 10) / 10} points.{' '}
                    {r.source === 'system'
                      ? `Figure pulled from ${r.source_detail ?? 'a connected system'}.`
                      : `${r.evidence.length} supporting document${r.evidence.length === 1 ? '' : 's'} attached.`}{' '}
                    {r.score?.adjusted === 1
                      ? `Adjusted from ${r.score.calculated_pct}% because: ${r.score.reason}`
                      : r.state === 'approved'
                        ? `Approved without adjustment by ${r.locked_by_name}.`
                        : 'Not yet approved.'}
                  </p>
                </li>
              ))}
          </ul>
        </Card>

        <Card className="p-5">
          <h2 className="font-semibold text-ink">Performance by period</h2>
          <p className="mt-1 text-sm text-ink3">Weighted score, comparable because targets are frozen.</p>
          <ul className="mt-4 space-y-3">
            {all.map((p) => {
              const t = employeeTotal(employeeId, p.id).total;
              const v = pctOf(t.score, t.scored_weight);
              return (
                <li key={p.id}>
                  <div className="flex items-baseline justify-between text-sm">
                    <span className={p.id === period.id ? 'font-semibold text-ink' : 'text-ink2'}>
                      {p.label}
                    </span>
                    <span className="num font-semibold text-ink">{v === null ? '—' : `${v}%`}</span>
                  </div>
                  <div className="mt-1.5">
                    <ToleranceRail pct={v} size="sm" />
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="mt-4 border-t border-rule2 pt-3 text-xs text-ink3">
            Targets and weights freeze when a period opens. Without that, a target lowered mid-period would
            make this comparison meaningless.
          </p>
        </Card>
      </div>
    </>
  );
}

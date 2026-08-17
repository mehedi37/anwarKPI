import Link from 'next/link';
import { currentPeriod, employeeTotal, periods } from '@/lib/queries';
import { currentUser } from '@/lib/session';
import { KpiRow } from '@/components/KpiCard';
import { Card, Empty, ErrorBanner, LinkButton, Measure, PageHeader } from '@/components/ui';

export default async function MyKpis({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; error?: string }>;
}) {
  const user = await currentUser();
  const sp = await searchParams;
  const all = await periods();
  const period = all.find((p) => String(p.id) === sp.period) ?? (await currentPeriod());
  const { records, total } = await employeeTotal(user.id, period.id);

  const pctOfScored = total.scored_weight > 0 ? Math.round((total.score / total.scored_weight) * 1000) / 10 : null;

  return (
    <>
      <ErrorBanner message={sp.error} />
      <PageHeader
        eyebrow="Target vs actual"
        title="My KPIs"
      >
        <div className="flex gap-1">
          {all.map((p) => (
            <Link
              key={p.id}
              href={`/my-kpis?period=${p.id}`}
              className={`border px-3 py-1.5 text-sm font-medium transition-colors ${
                p.id === period.id
                  ? 'border-datum bg-datum-soft text-datum'
                  : 'border-rule bg-white text-ink2 hover:bg-ground'
              }`}
            >
              {p.label}
            </Link>
          ))}
        </div>
      </PageHeader>

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Measure
          label="score so far"
          value={pctOfScored === null ? '—' : `${pctOfScored}%`}
          rail={{ pct: pctOfScored }}
          sub={`${total.score} points from ${total.scored_weight} of ${total.total_weight} weight`}
        />
        <Measure label="kpis assigned" value={records.length} sub={period.label} />
        <Measure
          label="awaiting your input"
          value={total.pending_count}
          sub="Not yet recorded"
          tone={total.pending_count > 0 ? 'signal' : 'datum'}
        />
      </div>

      {records.length === 0 ? (
        <Empty>No KPIs assigned for {period.label}.</Empty>
      ) : (
        <div className="space-y-3">
          {records.map((r) => {
            const actionable =
              (r.state === 'draft' || r.state === 'returned') && period.status === 'open';
            return (
              <KpiRow
                key={r.id}
                record={r}
                href={`/kpi/${r.id}`}
                footer={
                  actionable ? (
                    <LinkButton href={`/kpi/${r.id}/submit`} variant="primary">
                      {r.state === 'returned' ? 'Resubmit with clarification' : 'Record result and evidence'}
                    </LinkButton>
                  ) : undefined
                }
              />
            );
          })}
        </div>
      )}

    </>
  );
}

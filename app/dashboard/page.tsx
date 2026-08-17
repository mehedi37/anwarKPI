import Link from 'next/link';
import { currentPeriod, dashboard, periods } from '@/lib/queries';
import { currentUser, CAN } from '@/lib/session';
import { Card, Empty, Measure, PageHeader, Pct, ToleranceRail } from '@/components/ui';

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const user = await currentUser();
  if (!CAN.dashboard(user)) {
    return (
      <Empty>
        The management dashboard is not available to the employee role. Switch to a manager, approver or HR
        in the header.
      </Empty>
    );
  }

  const sp = await searchParams;
  const all = await periods();
  const period = all.find((p) => String(p.id) === sp.period) ?? (await currentPeriod());
  const d = await dashboard(period.id);

  const ranked = d.departments.filter((x) => x.avg !== null).sort((a, b) => (b.avg ?? 0) - (a.avg ?? 0));
  const best = ranked[0];
  const worst = ranked.at(-1);

  return (
    <>
      <PageHeader
        eyebrow="Management visibility"
        title="Management dashboard"
      >
        <div className="flex gap-1">
          {all.map((p) => (
            <Link
              key={p.id}
              href={`/dashboard?period=${p.id}`}
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
      </PageHeader>

      <div className="mb-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Measure
          label="employees evaluated"
          value={`${d.evaluated} / ${d.evaluated + d.pending}`}
          sub={`${d.pending} still have open KPIs`}
          tone={d.pending > 0 ? 'signal' : 'datum'}
        />
        <Measure
          label="average kpi score"
          value={d.avgScore === null ? '—' : `${d.avgScore}%`}
          rail={{ pct: d.avgScore }}
          sub="Weighted, per employee"
        />
        <Measure
          label="average target achievement"
          value={d.avgAchievement === null ? '—' : `${d.avgAchievement}%`}
          rail={{ pct: d.avgAchievement }}
          sub="Per KPI, unmeasured excluded"
        />
        <Measure
          label="approvals pending"
          value={d.approvalsPending}
          sub="Submitted or under review"
          tone={d.approvalsPending > 0 ? 'signal' : 'ink'}
          href="/approve"
        />
      </div>

      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="font-semibold text-ink">Departments</h2>
          <p className="mt-0.5 text-sm text-ink3">
            By average achievement.
          </p>
          <ul className="mt-4 space-y-3">
            {d.departments.map((dept) => (
              <li key={dept.name}>
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="font-medium text-ink">
                    {dept.name}
                    <span className="ml-2 text-xs font-normal text-ink3">{dept.business_unit}</span>
                    {best && dept.name === best.name && (
                      <span className="ml-2 bg-datum-soft px-1.5 py-0.5 text-xs font-semibold text-datum">
                        highest
                      </span>
                    )}
                    {worst && dept.name === worst.name && ranked.length > 1 && (
                      <span className="ml-2 bg-dev-soft px-1.5 py-0.5 text-xs font-semibold text-dev">
                        lowest
                      </span>
                    )}
                  </span>
                  <Pct value={dept.avg} />
                </div>
                <div className="mt-1.5">
                  <ToleranceRail pct={dept.avg} size="sm" />
                </div>
                <p className="label mt-1.5 text-ink3">{dept.records} scored kpis</p>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="p-5">
          <h2 className="font-semibold text-ink">Performance trend</h2>
          <p className="mt-0.5 text-sm text-ink3">Average achievement across all KPIs.</p>
          <ul className="mt-4 space-y-3.5">
            {d.trend.map((t) => (
              <li key={t.label}>
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className={t.label === period.label ? 'font-semibold text-ink' : 'text-ink2'}>
                    {t.label}
                  </span>
                  <Pct value={t.avg} />
                </div>
                <div className="mt-1.5">
                  <ToleranceRail pct={t.avg} size="sm" />
                </div>
              </li>
            ))}
          </ul>
          <p className="label mt-4 border-t border-rule2 pt-3 text-ink3">
            100% target · 120% cap
          </p>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="font-semibold text-ink">KPIs consistently below target</h2>
          <p className="mt-0.5 text-sm text-ink3">
            Below 100% for three or more consecutive periods — a recurring gap, not a bad month.
          </p>
          {d.belowTarget.length === 0 ? (
            <p className="mt-4 text-sm text-ink3">No KPI has been below target for three periods running.</p>
          ) : (
            <ul className="mt-4 space-y-2">
              {d.belowTarget.map((b) => (
                <li
                  key={`${b.employee}-${b.name}`}
                  className="flex items-center justify-between border border-dev/40 bg-dev-soft px-3 py-2 text-sm"
                >
                  <span>
                    <span className="font-medium text-ink">{b.name}</span>
                    <span className="ml-2 text-ink2">{b.employee}</span>
                  </span>
                  <span className="num font-semibold text-dev">{b.periods} periods</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-5">
          <h2 className="font-semibold text-ink">Scores manually adjusted</h2>
          <p className="mt-0.5 text-sm text-ink3">
            With the reason and the person who made it.
          </p>
          {d.adjustments.length === 0 ? (
            <p className="mt-4 text-sm text-ink3">No manual adjustments this period.</p>
          ) : (
            <ul className="mt-4 space-y-3">
              {d.adjustments.map((a, i) => (
                <li key={i} className="border border-lock/40 bg-lock-soft px-3 py-2 text-sm">
                  <div className="flex items-baseline justify-between gap-2">
                    <Link href={`/kpi/${a.kpi_id}`} className="font-medium text-ink hover:text-datum">
                      {a.kpi} — {a.employee}
                    </Link>
                    <span className="num whitespace-nowrap font-semibold text-lock">
                      {a.from}% → {a.to}%
                    </span>
                  </div>
                  <p className="mt-1 text-lock">&ldquo;{a.reason}&rdquo;</p>
                  <p className="mt-0.5 text-xs text-lock">
                    {a.by} · {new Date(a.at).toLocaleString('en-GB')}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

    </>
  );
}

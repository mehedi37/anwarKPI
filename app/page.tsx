import Link from 'next/link';
import { completedRecord, currentPeriod, dashboard } from '@/lib/queries';
import { currentUser } from '@/lib/session';
import { resetDemo } from '@/lib/actions';
import { formatValue } from '@/lib/scoring';
import { Button, Card, KeyCard, LinkButton, Measure, ToleranceRail } from '@/components/ui';

export default async function Home() {
  const user = await currentUser();
  const period = await currentPeriod();
  const d = await dashboard(period.id);
  const hero = await completedRecord(period.id);

  return (
    <>
      {/* The hero is the thesis: one finished measurement, with every link in
          its chain showing the real value that satisfies it. */}
      <KeyCard className="mb-6">
        <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-rule px-6 py-4">
          <div>
            <p className="label text-ink3">the shift this system makes</p>
            <p className="mt-2 text-sm">
              <span className="text-ink3 line-through decoration-dev/70 decoration-2">
                score → signature → approval
              </span>
            </p>
            <h1 className="num mt-1.5 text-lg font-semibold tracking-tight text-ink sm:text-xl">
              target → actual → evidence → score → review → approval
            </h1>
          </div>
        </div>

        {hero ? (
          <>
            <div className="flex flex-wrap items-baseline justify-between gap-2 px-6 pt-5">
              <p className="text-sm font-semibold text-ink">
                {hero.name}
                <span className="ml-2 font-normal text-ink2">
                  {hero.employee.name} · {hero.employee.dept} · {hero.period.label}
                </span>
              </p>
              <Link href={`/kpi/${hero.id}`} className="label text-datum hover:underline">
                open this record →
              </Link>
            </div>

            <ol className="grid px-6 py-5 sm:grid-cols-3 lg:grid-cols-6">
              {[
                { k: 'target', v: formatValue(hero.target, hero.unit) },
                { k: 'actual', v: formatValue(hero.actual, hero.unit) },
                {
                  k: 'evidence',
                  v: hero.source === 'system' ? (hero.source_detail ?? 'system pull') : `${hero.evidence.length} document${hero.evidence.length === 1 ? '' : 's'}`,
                },
                { k: 'score', v: `${hero.achievement_pct}%`, strong: true },
                { k: 'review', v: hero.reviewer.name },
                { k: 'approval', v: hero.locked_by_name ?? '—' },
              ].map((s) => (
                <li key={s.k} className="py-1 pr-5">
                  <p className="label text-ink3">{s.k}</p>
                  <p
                    className={`num mt-1.5 text-sm leading-snug ${s.strong ? 'text-base font-semibold text-datum' : 'text-ink'}`}
                  >
                    {s.v}
                  </p>
                </li>
              ))}
            </ol>

            <div className="px-6 pb-6">
              <ToleranceRail pct={hero.achievement_pct} capped={hero.cap_applied} />
              <div className="mt-2 flex justify-between">
                <span className="label text-ink3">0</span>
                <span className="label text-ink2">target 100%</span>
                <span className="label text-ink3">cap 120</span>
              </div>
            </div>
          </>
        ) : (
          <p className="px-6 py-8 text-sm text-ink2">
            No record has completed the full chain in {period.label} yet. Walk one through from{' '}
            <Link className="text-datum underline underline-offset-2" href="/my-kpis">
              My KPIs
            </Link>
            .
          </p>
        )}
      </KeyCard>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Measure label="period" value={period.label} sub={period.status === 'open' ? 'Open' : 'Closed'} />
        <Measure
          label="awaiting a decision"
          value={d.approvalsPending}
          sub="Submitted or under review"
          tone={d.approvalsPending > 0 ? 'signal' : 'ink'}
          href="/approve"
        />
        <Measure
          label="average achievement"
          value={d.avgAchievement === null ? '—' : `${d.avgAchievement}%`}
          rail={{ pct: d.avgAchievement }}
          sub="Unmeasured KPIs excluded"
          href="/dashboard"
        />
        <Measure
          label="manually adjusted"
          value={d.adjustments.length}
          sub="Each carries a written reason"
          tone={d.adjustments.length > 0 ? 'dev' : 'ink'}
          href="/dashboard"
        />
      </div>

      <Card className="p-5">
        <h2 className="font-semibold text-ink">Walk the whole flow</h2>
        <p className="mt-1.5 text-sm leading-relaxed text-ink2">
          Rafiq Ahmed&rsquo;s <strong className="font-semibold text-ink">Monthly Sales</strong> KPI for{' '}
          {period.label} has no result recorded yet.
        </p>
        <ol className="mt-4 space-y-2.5 text-sm text-ink2">
          {[
            ['Rafiq Ahmed', 'record the result and attach evidence', '/my-kpis', 'My KPIs'],
            ['Kamrul Islam', 'review, and adjust with a reason', '/review', 'Review'],
            ['Mahbub Rahman', 'approve — this locks the record', '/approve', 'Approvals'],
            ['Management', 'see the figures update', '/dashboard', 'Dashboard'],
          ].map(([who, what, href, label], i) => (
            <li key={href} className="flex gap-3">
              <span className="num text-xs font-semibold text-ink3">{i + 1}</span>
              <span>
                As <strong className="font-semibold text-ink">{who}</strong>, {what} —{' '}
                <Link href={href} className="font-medium text-datum underline underline-offset-2">
                  {label}
                </Link>
              </span>
            </li>
          ))}
        </ol>
        <div className="mt-5 flex flex-wrap gap-2">
          <LinkButton href="/my-kpis" variant="primary">
            Start the walkthrough
          </LinkButton>
          <form action={resetDemo}>
            <Button variant="secondary">Reset demo data</Button>
          </form>
        </div>
      </Card>
    </>
  );
}

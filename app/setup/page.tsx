import { db } from '@/lib/db';
import { employees, periods } from '@/lib/queries';
import { currentUser, CAN } from '@/lib/session';
import { Empty, ErrorBanner, PageHeader } from '@/components/ui';
import { KpiForm } from './KpiForm';

export default async function SetupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const user = await currentUser();
  if (!CAN.setupKpi(user)) {
    return (
      <Empty>
        KPI setup is restricted to managers and HR. Switch to <strong>Kamrul Islam</strong> or{' '}
        <strong>Ayesha Siddiqua</strong> in the header.
      </Empty>
    );
  }

  const staff = employees();
  const allPeriods = periods();

  const reviewers = db()
    .prepare(`SELECT id, name, role FROM employee WHERE role IN ('manager') ORDER BY name`)
    .all() as { id: number; name: string; role: string }[];
  const approvers = db()
    .prepare(`SELECT id, name, role FROM employee WHERE role = 'approver' ORDER BY name`)
    .all() as { id: number; name: string; role: string }[];

  const rows = db()
    .prepare(
      `SELECT employee_id, period_id, SUM(weight) AS total
       FROM kpi_assignment GROUP BY employee_id, period_id`,
    )
    .all() as { employee_id: number; period_id: number; total: number }[];

  const usedWeight: Record<string, number> = {};
  for (const r of rows) usedWeight[`${r.employee_id}:${r.period_id}`] = r.total;

  return (
    <>
      <ErrorBanner message={error} />
      <PageHeader
        eyebrow="KPI setup"
        title="Assign a KPI"
      />
      <KpiForm
        staff={staff}
        reviewers={reviewers}
        approvers={approvers}
        periods={allPeriods}
        usedWeight={usedWeight}
      />
    </>
  );
}

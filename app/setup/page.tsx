import { all } from '@/lib/db';
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

  const staff = await employees();
  const allPeriods = await periods();

  const reviewers = await all<{ id: number; name: string; role: string }>(
    `SELECT id, name, role FROM employee WHERE role IN ('manager') ORDER BY name`,
  );
  const approvers = await all<{ id: number; name: string; role: string }>(
    `SELECT id, name, role FROM employee WHERE role = 'approver' ORDER BY name`,
  );

  const rows = await all<{ employee_id: number; period_id: number; total: number }>(
    `SELECT employee_id, period_id, SUM(weight) AS total
     FROM kpi_assignment GROUP BY employee_id, period_id`,
  );

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

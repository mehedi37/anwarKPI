import { approvalQueue } from '@/lib/queries';
import { currentUser, CAN } from '@/lib/session';
import { KpiRow } from '@/components/KpiCard';
import { Card, Empty, PageHeader } from '@/components/ui';

export default async function ApprovePage() {
  const user = await currentUser();

  if (!CAN.approve(user)) {
    return (
      <Empty>
        Final approval is restricted to the approver role. Switch to <strong>Mahbub Rahman</strong> in the
        header to approve records.
      </Empty>
    );
  }

  const queue = await approvalQueue(user.id);

  return (
    <>
      <PageHeader
        eyebrow="Approval"
        title="Awaiting your approval"
        lead="Approving locks the record. Changes afterwards require an authorised HR correction."
      />

      {queue.length === 0 ? (
        <Empty>Nothing is waiting for approval.</Empty>
      ) : (
        <div className="space-y-3">
          {queue.map((r) => (
            <KpiRow key={r.id} record={r} href={`/kpi/${r.id}`} />
          ))}
        </div>
      )}

    </>
  );
}

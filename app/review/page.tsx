import { reviewQueue } from '@/lib/queries';
import { currentUser, CAN } from '@/lib/session';
import { KpiRow } from '@/components/KpiCard';
import { Card, Empty, PageHeader } from '@/components/ui';

export default async function ReviewPage() {
  const user = await currentUser();

  if (!CAN.review(user)) {
    return (
      <Empty>
        Reviewing is not available to your role. Switch to <strong>Kamrul Islam</strong> or{' '}
        <strong>Farhana Chowdhury</strong> in the header to see a review queue.
      </Empty>
    );
  }

  const queue = reviewQueue(user.id);
  const flagged = queue.filter((r) => r.ai?.status === 'mismatch' && !r.ai.resolution);

  return (
    <>
      <PageHeader
        eyebrow="Manager review"
        title="Review queue"
      />

      {flagged.length > 0 && (
        <Card className="mb-4 border-dev/40 bg-dev-soft p-4">
          <p className="text-sm font-semibold text-dev">
            {flagged.length} submission{flagged.length > 1 ? 's' : ''} where the attached evidence does not
            support the figure entered
          </p>

        </Card>
      )}

      {queue.length === 0 ? (
        <Empty>Nothing waiting for your review.</Empty>
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

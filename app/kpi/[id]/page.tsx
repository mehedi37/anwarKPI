import { notFound } from 'next/navigation';
import { auditTrail, getRecord } from '@/lib/queries';
import { currentUser, CAN } from '@/lib/session';
import { adjustScore, approve, correct, returnForClarification, startReview } from '@/lib/actions';
import { AiFlag, AuditTrail, ScoreHeadline } from '@/components/detail';
import { FiveAnswers } from '@/components/KpiCard';
import {
  Button,
  Card,
  ErrorBanner,
  Field,
  LinkButton,
  PageHeader,
  StateBadge,
  TypeBadge,
  inputCls,
} from '@/components/ui';

export default async function RecordPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;
  const record = await getRecord(Number(id));
  if (!record) notFound();

  const user = await currentUser();
  const trail = await auditTrail(record.id);
  const locked = record.state === 'approved' || record.state === 'corrected';

  const canReview = CAN.review(user) && !locked && record.reviewer.id === user.id;
  const canAdjust = CAN.adjust(user) && !locked && record.state !== 'draft';
  const canApprove = CAN.approve(user) && !locked && record.state === 'under_review' && record.approver.id === user.id;
  const canCorrect = CAN.correct(user) && locked;
  const canSubmit =
    CAN.enterActual(user) && !locked && (record.state === 'draft' || record.state === 'returned');

  return (
    <>
      <ErrorBanner message={error} />
      <PageHeader
        eyebrow={`${record.employee.name} · ${record.employee.dept} · ${record.period.label}`}
        title={record.name}
        lead={record.description ?? undefined}
      >
        <div className="flex flex-wrap items-center gap-2">
          <TypeBadge type={record.type} />
          <StateBadge state={record.state} />
        </div>
      </PageHeader>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <ScoreHeadline record={record} />

          {record.ai && <AiFlag record={record} user={user} suggestion={record.ai} />}

          <FiveAnswers record={record} />

          {record.type === 'milestone' && record.milestones.length > 0 && (
            <Card className="p-4">
              <h2 className="mb-3 font-semibold text-ink">Milestones</h2>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-rule text-left text-xs uppercase tracking-wide text-ink3">
                    <th className="py-2 font-semibold">Milestone</th>
                    <th className="py-2 font-semibold">Weight</th>
                    <th className="py-2 font-semibold">Due</th>
                    <th className="py-2 font-semibold">Completed</th>
                    <th className="py-2 font-semibold">Result</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-rule2">
                  {record.milestones.map((m, i) => {
                    const onTime = m.completed_date && m.completed_date <= m.due_date;
                    return (
                      <tr key={i}>
                        <td className="py-2 pr-2 text-ink">{m.title}</td>
                        <td className="num py-2 pr-2">{m.sub_weight}</td>
                        <td className="num py-2 pr-2 text-ink2">{m.due_date}</td>
                        <td className="num py-2 pr-2 text-ink2">{m.completed_date ?? '—'}</td>
                        <td className="py-2">
                          <span
                            className={`border px-2 py-0.5 text-xs font-semibold ${
                              onTime
                                ? 'border-datum/30 bg-datum-soft text-datum'
                                : 'border-dev/40 bg-dev-soft text-dev'
                            }`}
                          >
                            {onTime ? 'On time' : m.completed_date ? 'Late' : 'Not complete'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Card>
          )}

          {record.comment && (
            <Card className="p-4">
              <h2 className="mb-1 text-sm font-semibold text-ink">Employee comment</h2>
              <p className="text-sm text-ink2">{record.comment}</p>
            </Card>
          )}

          <AuditTrail entries={trail} history={record.score_history} />
        </div>

        <aside className="space-y-4">
          {locked && (
            <Card className="border-datum/30 bg-datum-soft/50 p-4">
              <h2 className="text-sm font-semibold text-ink">Record locked</h2>
              <p className="mt-1 text-sm text-ink2">
                Approved by {record.locked_by_name} on{' '}
                {new Date(record.locked_at!).toLocaleString('en-GB')}. Changes require an authorised HR
                correction.
              </p>
            </Card>
          )}

          {canSubmit && (
            <Card className="p-4">
              <h2 className="text-sm font-semibold text-ink">Action needed</h2>
              <p className="mt-1 text-sm text-ink2">
                {record.state === 'returned'
                  ? 'This record was returned for clarification.'
                  : 'No result has been recorded for this KPI yet.'}
              </p>
              <div className="mt-3">
                <LinkButton href={`/kpi/${record.id}/submit`} variant="primary">
                  Record result and evidence
                </LinkButton>
              </div>
            </Card>
          )}

          {canReview && record.state === 'submitted' && (
            <Card className="p-4">
              <h2 className="text-sm font-semibold text-ink">Review</h2>
              <p className="mt-1 text-sm text-ink2">
                Sends this to {record.approver.name} for approval.
              </p>
              <form action={startReview} className="mt-3">
                <input type="hidden" name="kpi_id" value={record.id} />
                <Button variant="primary">Accept and send for approval</Button>
              </form>
            </Card>
          )}

          {canReview && (
            <Card className="p-4">
              <h2 className="text-sm font-semibold text-ink">Return for clarification</h2>
              <form action={returnForClarification} className="mt-2 space-y-2">
                <input type="hidden" name="kpi_id" value={record.id} />
                <textarea
                  name="reason"
                  rows={2}
                  required
                  placeholder="What does the employee need to clarify?"
                  className={inputCls}
                />
                <Button variant="secondary">Return to {record.employee.name.split(' ')[0]}</Button>
              </form>
            </Card>
          )}

          {canAdjust && (
            <Card className="p-4">
              <h2 className="text-sm font-semibold text-ink">Adjust the score</h2>
              <p className="mt-1 text-sm text-ink2">
                The calculated score of{' '}
                <strong className="num">{record.score?.calculated_pct ?? '—'}%</strong> is kept. Your
                adjustment is saved as a new version with your reason.
              </p>
              <form action={adjustScore} className="mt-3 space-y-2">
                <input type="hidden" name="kpi_id" value={record.id} />
                <Field label="Adjusted achievement %">
                  <input
                    name="final_pct"
                    type="number"
                    step="0.1"
                    required
                    defaultValue={record.achievement_pct ?? undefined}
                    className={inputCls}
                  />
                </Field>
                <Field label="Reason (required)">
                  <textarea
                    name="reason"
                    rows={2}
                    required
                    placeholder="e.g. Evidence shows BDT 8.4m net of cancellations, not 9.0m as entered."
                    className={inputCls}
                  />
                </Field>
                <Button variant="secondary">Save adjustment</Button>
              </form>
            </Card>
          )}

          {canApprove && (
            <Card className="border-datum p-4">
              <h2 className="text-sm font-semibold text-ink">Final approval</h2>
              <p className="mt-1 text-sm text-ink2">
                Approving locks this record at{' '}
                <strong className="num">{record.achievement_pct}%</strong> with your name and the time.
              </p>
              <form action={approve} className="mt-3">
                <input type="hidden" name="kpi_id" value={record.id} />
                <Button variant="primary">Approve and lock</Button>
              </form>
            </Card>
          )}

          {canCorrect && (
            <Card className="border-lock/40 p-4">
              <h2 className="text-sm font-semibold text-ink">Authorised correction (HR)</h2>
              <p className="mt-1 text-sm text-ink2">
                The approved score is not overwritten. A new version is recorded and both remain visible.
              </p>
              <form action={correct} className="mt-3 space-y-2">
                <input type="hidden" name="kpi_id" value={record.id} />
                <Field label="Corrected achievement %">
                  <input
                    name="final_pct"
                    type="number"
                    step="0.1"
                    required
                    defaultValue={record.achievement_pct ?? undefined}
                    className={inputCls}
                  />
                </Field>
                <Field label="Reason (required)">
                  <textarea name="reason" rows={2} required className={inputCls} />
                </Field>
                <Button variant="secondary">Apply correction</Button>
              </form>
            </Card>
          )}

          <Card className="p-4">
            <h2 className="text-sm font-semibold text-ink">Routing</h2>
            <dl className="mt-2 space-y-1.5 text-sm">
              <div className="flex justify-between gap-2">
                <dt className="text-ink3">Employee</dt>
                <dd className="text-ink">{record.employee.name}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-ink3">Reviewer</dt>
                <dd className="text-ink">{record.reviewer.name}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-ink3">Approver</dt>
                <dd className="text-ink">{record.approver.name}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-ink3">Weight</dt>
                <dd className="num text-ink">{record.weight}%</dd>
              </div>
            </dl>
          </Card>
        </aside>
      </div>
    </>
  );
}

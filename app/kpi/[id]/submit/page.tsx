import { notFound } from 'next/navigation';
import { getRecord, sampleEvidence } from '@/lib/queries';
import { submitActual } from '@/lib/actions';
import { fmt } from '@/lib/scoring';
import { Button, Card, ErrorBanner, Field, LinkButton, PageHeader, TypeBadge, inputCls } from '@/components/ui';

export default async function SubmitPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;
  const record = getRecord(Number(id));
  if (!record) notFound();

  const samples = sampleEvidence();
  const locked = record.state === 'approved' || record.state === 'corrected';

  return (
    <>
      <ErrorBanner message={error} />
      <PageHeader
        eyebrow={`${record.period.label} · weight ${record.weight}%`}
        title={record.name}
        lead={record.description ?? undefined}
      >
        <LinkButton href={`/kpi/${record.id}`}>Back to record</LinkButton>
      </PageHeader>

      {locked ? (
        <Card className="p-6 text-sm text-ink2">
          This record is locked and cannot be edited. Corrections go through HR.
        </Card>
      ) : (
        <form action={submitActual} className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <input type="hidden" name="kpi_id" value={record.id} />

          <div className="space-y-4">
            <Card className="p-5">
              <div className="mb-4 flex items-center gap-2">
                <h2 className="font-semibold text-ink">1. Record the result</h2>
                <TypeBadge type={record.type} />
              </div>

              {(record.type === 'standard' || record.type === 'inverse') && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Target (frozen at period start)">
                    <input
                      className={`${inputCls} bg-ground text-ink3`}
                      value={`${fmt(record.target ?? 0)}${record.unit ? ` ${record.unit}` : ''}`}
                      readOnly
                    />
                  </Field>
                  <Field
                    label={`Actual achieved${record.unit ? ` (${record.unit})` : ''}`}
                    hint={record.type === 'inverse' ? 'Lower is better for this KPI.' : undefined}
                  >
                    <input
                      name="value"
                      type="number"
                      step="any"
                      required
                      placeholder="e.g. 9000000"
                      className={inputCls}
                    />
                  </Field>
                </div>
              )}

              {record.type === 'qualitative' && (
                <fieldset>
                  <legend className="mb-2 text-sm font-semibold text-ink2">
                    Select the rubric level that matches the evidence
                  </legend>
                  <p className="mb-3 text-xs text-ink3">
                    Levels were fixed at KPI setup. Each maps to a set achievement %.
                  </p>
                  <div className="space-y-2">
                    {record.rubric.map((r) => (
                      <label
                        key={r.level}
                        className="flex cursor-pointer gap-3 border border-rule p-3 transition-colors hover:border-datum hover:bg-datum-soft/30"
                      >
                        <input type="radio" name="rubric_level" value={r.level} required className="mt-1" />
                        <span>
                          <span className="block text-sm font-semibold text-ink">
                            Level {r.level} — {r.label}{' '}
                            <span className="num font-normal text-ink3">({r.achievement_pct}%)</span>
                          </span>
                          <span className="block text-sm text-ink2">{r.criteria_text}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              )}

              {record.type === 'milestone' && (
                <div>
                  <p className="mb-3 text-xs text-ink3">
                    Enter the date each milestone was completed. Only milestones finished on or before their
                    due date count towards the score.
                  </p>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-rule text-left text-xs uppercase tracking-wide text-ink3">
                        <th className="py-2 font-semibold">Milestone</th>
                        <th className="py-2 font-semibold">Weight</th>
                        <th className="py-2 font-semibold">Due</th>
                        <th className="py-2 font-semibold">Completed</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-rule2">
                      {record.milestones.map((m, i) => (
                        <tr key={i}>
                          <td className="py-2 pr-2">{m.title}</td>
                          <td className="num py-2 pr-2">{m.sub_weight}</td>
                          <td className="num py-2 pr-2 text-ink2">{m.due_date}</td>
                          <td className="py-2">
                            <input
                              type="date"
                              name={`ms_${i + 1}`}
                              defaultValue={m.completed_date ?? ''}
                              className={`${inputCls} py-1.5`}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="mt-4">
                <Field label="Comment (optional)">
                  <textarea
                    name="comment"
                    rows={2}
                    placeholder="Anything the reviewer should know about this result."
                    className={inputCls}
                  />
                </Field>
              </div>
            </Card>

            <Card className="p-5">
              <h2 className="mb-1 font-semibold text-ink">2. Attach supporting evidence</h2>
              <p className="mb-4 text-sm text-ink2">
                A manual entry cannot be submitted without a supporting document.
              </p>

              <input type="hidden" name="source" value="manual" />

              {samples.length > 0 && (
                <fieldset className="mb-4">
                  <legend className="mb-2 text-sm font-semibold text-ink2">
                    Use a sample document
                  </legend>
                  <div className="space-y-2">
                    {samples.map((s) => (
                      <label
                        key={s.id}
                        className="flex cursor-pointer items-start gap-3 border border-rule p-3 transition-colors hover:border-datum hover:bg-datum-soft/30"
                      >
                        <input type="checkbox" name="sample_evidence" value={s.id} className="mt-1" />
                        <span>
                          <span className="block text-sm font-medium text-ink">{s.label}</span>
                          <span className="block text-xs text-ink3">{s.filename}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              )}

              <Field label="Or upload your own" hint="PDF, image, CSV or text. Multiple files allowed.">
                <input
                  type="file"
                  name="evidence"
                  multiple
                  className="w-full border border-dashed border-rule bg-ground px-3 py-4 text-sm text-ink2 file:mr-3 file:border-0 file:bg-ink file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-white"
                />
              </Field>
            </Card>

            <div className="flex justify-end gap-2">
              <LinkButton href="/my-kpis">Cancel</LinkButton>
              <Button type="submit" variant="primary">
                Submit for review
              </Button>
            </div>
          </div>

          <aside className="space-y-4">
            <Card className="p-4">
              <h3 className="text-sm font-semibold text-ink">After you submit</h3>
              <ol className="mt-2 space-y-2 text-sm text-ink2">
                <li>Your score is calculated from the target and the result you entered.</li>
                <li>
                  Your attachment is checked against the figure you entered. Any difference is flagged for
                  the reviewer.
                </li>
                <li>
                  {record.reviewer.name} reviews it, then {record.approver.name} approves.
                </li>
                <li>The record is locked on approval.</li>
              </ol>
            </Card>

          </aside>
        </form>
      )}
    </>
  );
}

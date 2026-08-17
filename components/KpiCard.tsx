import Link from 'next/link';
import type { KpiRecord } from '@/lib/queries';
import { formatValue } from '@/lib/scoring';
import { Card, Pct, Reading, StateBadge, TypeBadge, SourceBadge } from './ui';

/** One KPI as a row: used in the employee list, the review queue and approvals. */
export function KpiRow({
  record,
  href,
  footer,
}: {
  record: KpiRecord;
  href?: string;
  footer?: React.ReactNode;
}) {
  const target =
    record.type === 'milestone'
      ? `${record.milestones.length} milestones`
      : record.type === 'qualitative'
        ? 'Rubric 1–5'
        : formatValue(record.target, record.unit);

  const actual =
    record.type === 'milestone'
      ? `${record.milestones.filter((m) => m.completed_date && m.completed_date <= m.due_date).length} on time`
      : record.type === 'qualitative'
        ? record.rubric_level
          ? `Level ${record.rubric_level}`
          : '—'
        : formatValue(record.actual, record.unit);

  const inner = (
    <div className={`p-4 ${href ? 'transition-colors hover:bg-ground/30' : ''}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold text-ink">{record.name}</h3>
            <TypeBadge type={record.type} />
            <StateBadge state={record.state} />
          </div>
          <p className="mt-1 text-xs text-ink3">
            {record.employee.name} · {record.employee.dept} · {record.period.label} · weight {record.weight}%
          </p>
        </div>
        {record.ai?.status === 'mismatch' && !record.ai.resolution && (
          <span className="border border-dev/40 bg-dev-soft px-2 py-1 text-xs font-semibold text-dev">
            ⚑ Evidence mismatch
          </span>
        )}
      </div>

      <div className="mt-3.5 grid gap-3 border border-rule2 bg-ground/50 px-3.5 py-3 sm:grid-cols-[1fr_1fr_1.2fr]">
        <div>
          <p className="label text-ink3">target</p>
          <p className="num mt-1 text-sm text-ink">{target}</p>
        </div>
        <div>
          <p className="label text-ink3">actual</p>
          <p className="num mt-1 text-sm text-ink">{actual}</p>
        </div>
        <Reading pct={record.achievement_pct} capped={record.cap_applied} />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <SourceBadge source={record.source} detail={record.source_detail} />
        {record.evidence.length > 0 && (
          <span className="text-xs text-ink3">
            {record.evidence.length} document{record.evidence.length > 1 ? 's' : ''} attached
          </span>
        )}
        {record.score?.adjusted === 1 && (
          <span className="border border-lock/40 bg-lock-soft px-2 py-0.5 text-xs font-medium text-lock">
            Manually adjusted
          </span>
        )}
      </div>
    </div>
  );

  const body = <Card className={href ? 'transition-colors hover:border-ink' : ''}>{inner}</Card>;

  const linked = href ? (
    <Link href={href} className="block">
      {body}
    </Link>
  ) : (
    body
  );

  if (!footer) return linked;
  return (
    <div className="border border-rule bg-paper">
      {href ? <Link href={href} className="block">{inner}</Link> : inner}
      <div className="flex justify-end border-t border-rule2 bg-ground/40 px-4 py-3">{footer}</div>
    </div>
  );
}

/** The five questions every record must answer. */
export function FiveAnswers({ record }: { record: KpiRecord }) {
  const rows: { q: string; a: React.ReactNode }[] = [
    {
      q: 'What was the target?',
      a:
        record.type === 'milestone'
          ? `${record.milestones.length} dated milestones`
          : record.type === 'qualitative'
            ? 'Rubric levels 1–5, defined at setup'
            : formatValue(record.target, record.unit),
    },
    {
      q: 'What was actually achieved?',
      a:
        record.type === 'milestone'
          ? `${record.milestones.filter((m) => m.completed_date && m.completed_date <= m.due_date).length} of ${record.milestones.length} milestones completed on time`
          : record.type === 'qualitative'
            ? record.rubric_level
              ? `Level ${record.rubric_level} — ${record.rubric.find((r) => r.level === record.rubric_level)?.label}`
              : 'Not yet recorded'
            : formatValue(record.actual, record.unit),
    },
    {
      q: 'What evidence supports the result?',
      a:
        record.source === 'system' ? (
          <>Pulled from {record.source_detail ?? 'a connected system'} — no manual entry.</>
        ) : record.evidence.length ? (
          <ul className="space-y-1">
            {record.evidence.map((e) => (
              <li key={e.id}>
                <a
                  className="font-medium text-datum underline underline-offset-2"
                  href={`/evidence/${encodeURIComponent(e.file_ref)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {e.filename}
                </a>
              </li>
            ))}
          </ul>
        ) : (
          'No evidence attached yet.'
        ),
    },
    {
      q: 'How was the score calculated?',
      a: (
        <>
          {/* Resolves to the calculated figure; an adjustment is shown separately. */}
          <span className="num">{record.formula}</span>
          {record.score?.calculated_pct != null && (
            <>
              {' = '}
              <Pct value={record.score.calculated_pct} />
            </>
          )}
          {record.cap_applied && <span className="text-ink3"> · capped at 120%</span>}
          {record.score?.adjusted === 1 && (
            <span className="mt-1 block text-lock">
              Then manually adjusted to <strong className="num">{record.score.final_pct}%</strong> by{' '}
              {record.score.created_by_name} — &ldquo;{record.score.reason}&rdquo;
            </span>
          )}
          <span className="block text-xs text-ink3">
            formula {record.score?.formula_version ?? 'v1'} · weight {record.weight}%
          </span>
        </>
      ),
    },
    {
      q: 'Who reviewed and approved it?',
      a:
        record.state === 'approved' || record.state === 'corrected' ? (
          <>
            Reviewed by {record.reviewer.name}. Locked by {record.locked_by_name} on{' '}
            {new Date(record.locked_at!).toLocaleString('en-GB')}.
          </>
        ) : (
          <>
            Routed to {record.reviewer.name} for review, then {record.approver.name} for approval. Not yet
            approved.
          </>
        ),
    },
  ];

  return (
    <Card className="divide-y divide-rule2">
      {rows.map((r) => (
        <div key={r.q} className="grid gap-1 px-4 py-3 sm:grid-cols-[minmax(0,15rem)_1fr] sm:gap-4">
          <p className="text-sm font-semibold text-ink3">{r.q}</p>
          <div className="text-sm text-ink">{r.a}</div>
        </div>
      ))}
    </Card>
  );
}

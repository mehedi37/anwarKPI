import { resolveSuggestion } from '@/lib/actions';
import type { AuditEntry, KpiRecord, ScoreRow } from '@/lib/queries';
import type { Suggestion } from '@/lib/ai';
import type { User } from '@/lib/roles';
import { CAN } from '@/lib/roles';
import { fmt } from '@/lib/scoring';
import { Button, Card, Pct, ToleranceRail } from './ui';

const ACTION_LABEL: Record<string, string> = {
  assign: 'KPI assigned',
  submit: 'Result and evidence submitted',
  review: 'Opened for review',
  return: 'Returned for clarification',
  adjust: 'Score manually adjusted',
  approve: 'Final approval — record locked',
  correct: 'Authorised correction applied',
  ai_accept: 'Evidence-check finding accepted',
  ai_override: 'Evidence-check finding overridden',
};

/** Append-only: rows are never updated or deleted. */
export function AuditTrail({ entries, history }: { entries: AuditEntry[]; history: ScoreRow[] }) {
  return (
    <Card className="p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="font-semibold text-ink">Audit trail</h2>
        <span className="text-xs text-ink3">{entries.length} events</span>
      </div>

      <ol className="relative space-y-4 border-l border-rule pl-5">
        {entries.map((e) => (
          <li key={e.id} className="relative">
            <span className="absolute -left-[1.4rem] top-1.5 h-2 w-2 rounded-full bg-datum" />
            <p className="text-sm font-medium text-ink">{ACTION_LABEL[e.action] ?? e.action}</p>
            <p className="text-xs text-ink3">
              {e.actor_name} ({e.actor_role}) · {new Date(e.at).toLocaleString('en-GB')}
            </p>
            {e.prev_pct !== null && e.new_pct !== null && (
              <p className="num mt-1 text-xs text-ink2">
                {e.prev_pct}% → <span className="font-semibold">{e.new_pct}%</span>
              </p>
            )}
            {e.reason && (
              <p className="mt-1 border border-rule bg-ground px-2 py-1 text-xs text-ink2">
                “{e.reason}”
              </p>
            )}
          </li>
        ))}
      </ol>

      {history.length > 1 && (
        <div className="mt-5 border-t border-rule2 pt-4">
          <h3 className="mb-2 text-sm font-semibold text-ink">Score versions</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-rule text-left text-xs uppercase tracking-wide text-ink3">
                <th className="py-1.5 font-semibold">Version</th>
                <th className="py-1.5 font-semibold">Calculated</th>
                <th className="py-1.5 font-semibold">Final</th>
                <th className="py-1.5 font-semibold">By</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-rule2">
              {history.map((h, i) => (
                <tr key={h.id} className={i === 0 ? 'bg-datum-soft/40' : ''}>
                  <td className="py-1.5 text-xs text-ink2">
                    {i === 0 ? 'Current' : `v${history.length - i}`}
                  </td>
                  <td className="num py-1.5">{h.calculated_pct === null ? '—' : `${h.calculated_pct}%`}</td>
                  <td className="num py-1.5 font-semibold">
                    {h.final_pct === null ? '—' : `${h.final_pct}%`}
                    {h.adjusted === 1 && <span className="ml-1 text-xs font-normal text-lock">adjusted</span>}
                  </td>
                  <td className="py-1.5 text-xs text-ink2">{h.created_by_name ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

const AI_STYLE: Record<Suggestion['status'], { title: string; cls: string; icon: string }> = {
  mismatch: {
    title: 'Evidence does not match the entered figure',
    cls: 'border-dev/40 bg-dev-soft',
    icon: '⚑',
  },
  match: {
    title: 'Evidence supports the entered figure',
    cls: 'border-datum/30 bg-datum-soft',
    icon: '✓',
  },
  not_found: {
    title: 'No corresponding figure found in the evidence',
    cls: 'border-signal/40 bg-signal-soft',
    icon: '?',
  },
  error: {
    title: 'Evidence check could not run',
    cls: 'border-rule bg-ground',
    icon: 'i',
  },
};

/** AI output is advisory: it never writes to `score`, and resolving it is audited. */
export function AiFlag({
  record,
  user,
  suggestion,
}: {
  record: KpiRecord;
  user: User;
  suggestion: Suggestion;
}) {
  const s = AI_STYLE[suggestion.status];
  const canResolve = CAN.review(user) && record.state !== 'approved' && record.state !== 'corrected';

  return (
    <div className={`border p-4 ${s.cls}`}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 text-lg leading-none" aria-hidden>
          {s.icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-semibold text-ink">{s.title}</h3>
            <span className="text-xs text-ink3">AI assist · {suggestion.model_id}</span>
          </div>

          {suggestion.status === 'mismatch' && (
            <p className="num mt-2 text-sm text-ink">
              Employee entered <strong>{fmt(suggestion.claimed_value ?? 0)}</strong>. The attached document
              supports <strong>{fmt(suggestion.extracted_value ?? 0)}</strong>.
            </p>
          )}

          <p className="mt-2 whitespace-pre-line text-sm text-ink2">{suggestion.rationale}</p>

          {suggestion.resolution ? (
            <p className="mt-2 text-xs font-semibold text-ink2">
              {suggestion.resolution === 'accepted' ? 'Accepted' : 'Overridden'} by{' '}
              {suggestion.resolved_by_name}
            </p>
          ) : (
            canResolve && (
              <form action={resolveSuggestion} className="mt-3 flex flex-wrap gap-2">
                <input type="hidden" name="kpi_id" value={record.id} />
                <input type="hidden" name="suggestion_id" value={suggestion.id} />
                <Button name="resolution" value="accepted" variant="secondary">
                  Accept finding
                </Button>
                <Button name="resolution" value="overridden" variant="secondary">
                  Override — evidence is fine
                </Button>
              </form>
            )
          )}
        </div>
      </div>
    </div>
  );
}

export function ScoreHeadline({ record }: { record: KpiRecord }) {
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-ink3">Achievement</p>
          <p className="mt-1 text-4xl font-bold">
            <Pct value={record.achievement_pct} />
          </p>
          <p className="num mt-1 text-sm text-ink3">{record.formula}</p>
        </div>
        <div className="text-right">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink3">Weighted contribution</p>
          <p className="num mt-1 text-2xl font-bold text-ink">
            {record.achievement_pct === null
              ? '—'
              : `${Math.round(((record.achievement_pct * record.weight) / 100) * 10) / 10} pts`}
          </p>
          <p className="text-xs text-ink3">of {record.weight} weight</p>
        </div>
      </div>

      <div className="mt-5">
        <ToleranceRail pct={record.achievement_pct} capped={record.cap_applied} />
        <div className="mt-2 flex justify-between">
          <span className="label text-ink3">0</span>
          <span className="label text-ink2">target 100%</span>
          <span className="label text-ink3">cap 120</span>
        </div>
      </div>

      {record.score?.adjusted === 1 && (
        <div className="mt-4 border border-lock/40 bg-lock-soft p-3 text-sm">
          <p className="num font-semibold text-lock">
            Manually adjusted from {record.score.calculated_pct}% to {record.score.final_pct}%
          </p>
          <p className="mt-1 text-lock">“{record.score.reason}”</p>
        </div>
      )}
    </Card>
  );
}

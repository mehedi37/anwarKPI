import Link from 'next/link';
import type { ReactNode } from 'react';
import { CAP_PCT, band } from '@/lib/scoring';
import type { State } from '@/lib/queries';

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`border border-rule bg-paper ${className}`}>{children}</div>;
}

/** Heavier frame for the primary panel on a screen. */
export function KeyCard({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`border border-ink/85 bg-paper shadow-[3px_3px_0_0_rgba(16,29,36,0.08)] ${className}`}>
      {children}
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  lead,
  children,
}: {
  eyebrow?: string;
  title: string;
  lead?: string;
  children?: ReactNode;
}) {
  return (
    <div className="mb-7 flex flex-wrap items-end justify-between gap-4 border-b border-ink/25 pb-5">
      <div>
        {eyebrow && <p className="label mb-2 text-ink3">{eyebrow}</p>}
        <h1 className="text-[1.75rem] font-bold leading-none tracking-tight text-ink">{title}</h1>
        {lead && <p className="mt-2.5 max-w-2xl text-sm leading-relaxed text-ink2">{lead}</p>}
      </div>
      {children}
    </div>
  );
}

/**
 * Achievement drawn against its target: a 0–cap track with a tick at 100%.
 * A pending KPI renders as an empty hatched track, not a bar at zero.
 */
export function ToleranceRail({
  pct,
  capped = false,
  size = 'md',
}: {
  pct: number | null;
  capped?: boolean;
  size?: 'sm' | 'md';
}) {
  const h = size === 'sm' ? 'h-2' : 'h-3';
  const datumLeft = (100 / CAP_PCT) * 100; // where 100% sits on a 0..120 track

  if (pct === null) {
    return (
      <div className={`relative w-full ${h} border border-rule bg-[repeating-linear-gradient(135deg,transparent,transparent_3px,var(--color-rule)_3px,var(--color-rule)_4px)]`}>
        <span
          className="absolute top-[-3px] bottom-[-3px] w-px bg-ink/45"
          style={{ left: `${datumLeft}%` }}
          aria-hidden
        />
      </div>
    );
  }

  const width = Math.min((pct / CAP_PCT) * 100, 100);
  const under = pct < 100;

  return (
    <div className={`relative w-full ${h} border border-rule bg-ground/60`}>
      <span
        className={`absolute inset-y-0 left-0 ${under ? 'bg-dev' : 'bg-datum'}`}
        style={{ width: `${width}%` }}
      />
      <span
        className="absolute top-[-3px] bottom-[-3px] w-px bg-ink/70"
        style={{ left: `${datumLeft}%` }}
        aria-hidden
      />
      {capped && (
        <span className="absolute inset-y-0 right-0 w-[3px] bg-ink" aria-hidden title="Capped at 120%" />
      )}
    </div>
  );
}

/** Achievement figure with its rail. */
export function Reading({
  pct,
  capped,
  className = '',
}: {
  pct: number | null;
  capped?: boolean;
  className?: string;
}) {
  return (
    <div className={className}>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <Pct value={pct} />
        {capped && <span className="label text-[0.625rem] text-ink3">capped</span>}
      </div>
      <ToleranceRail pct={pct} capped={capped} size="sm" />
    </div>
  );
}

const STATE_STYLE: Record<State, { label: string; cls: string }> = {
  draft: { label: 'Assigned', cls: 'border-rule bg-ground text-ink2' },
  submitted: { label: 'Submitted', cls: 'border-signal/35 bg-signal-soft text-signal' },
  under_review: { label: 'Under review', cls: 'border-ink/25 bg-ground text-ink' },
  returned: { label: 'Returned', cls: 'border-dev/35 bg-dev-soft text-dev' },
  approved: { label: 'Approved · locked', cls: 'border-lock/35 bg-lock-soft text-lock' },
  corrected: { label: 'Corrected · locked', cls: 'border-lock/35 bg-lock-soft text-lock' },
};

export function StateBadge({ state }: { state: State }) {
  const s = STATE_STYLE[state];
  return (
    <span className={`label inline-flex items-center gap-1 border px-1.5 py-1 text-[0.625rem] ${s.cls}`}>
      {(state === 'approved' || state === 'corrected') && <LockIcon />}
      {s.label}
    </span>
  );
}

export function Pct({ value, className = '' }: { value: number | null; className?: string }) {
  const b = band(value);
  if (b === 'pending') {
    return <span className={`label text-ink3 ${className}`}>Not measured</span>;
  }
  return (
    <span className={`num font-semibold ${b === 'below' ? 'text-dev' : 'text-datum'} ${className}`}>
      {value}%
    </span>
  );
}

export function TypeBadge({ type }: { type: string }) {
  const map: Record<string, string> = {
    standard: 'higher is better',
    inverse: 'lower is better',
    milestone: 'milestone',
    qualitative: 'rubric',
  };
  return <span className="label border border-rule px-1.5 py-1 text-[0.625rem] text-ink3">{map[type] ?? type}</span>;
}

export function SourceBadge({ source, detail }: { source: string | null; detail?: string | null }) {
  if (!source) return null;
  if (source === 'system') {
    return (
      <span className="label inline-flex items-center gap-1.5 border border-datum/30 bg-datum-soft px-1.5 py-1 text-[0.625rem] text-datum">
        <CheckIcon /> from {detail ?? 'system'}
      </span>
    );
  }
  return (
    <span className="label inline-flex items-center gap-1.5 border border-signal/35 bg-signal-soft px-1.5 py-1 text-[0.625rem] text-signal">
      <DocIcon /> manual · evidence required
    </span>
  );
}

export function Button({
  children,
  variant = 'primary',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' }) {
  const styles = {
    primary: 'border-ink bg-ink text-paper hover:bg-ink/85',
    secondary: 'border-ink/30 bg-paper text-ink hover:border-ink hover:bg-ground',
  }[variant];
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-2 border px-3.5 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${styles} ${props.className ?? ''}`}
    >
      {children}
    </button>
  );
}

export function LinkButton({
  href,
  children,
  variant = 'secondary',
}: {
  href: string;
  children: ReactNode;
  variant?: 'primary' | 'secondary';
}) {
  const styles =
    variant === 'primary'
      ? 'border-ink bg-ink text-paper hover:bg-ink/85'
      : 'border-ink/30 bg-paper text-ink hover:border-ink hover:bg-ground';
  return (
    <Link
      href={href}
      className={`inline-flex items-center justify-center gap-2 border px-3.5 py-2 text-sm font-medium transition-colors ${styles}`}
    >
      {children}
    </Link>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="label mb-1.5 block text-ink2">{label}</span>
      {hint && <span className="mb-2 block text-xs leading-relaxed text-ink3">{hint}</span>}
      {children}
    </label>
  );
}

export const inputCls =
  'w-full border border-rule bg-paper px-3 py-2 text-sm text-ink outline-none transition-colors placeholder:text-ink3 focus:border-datum';

export function ErrorBanner({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <div className="mb-6 flex gap-3 border border-dev/40 bg-dev-soft p-4">
      <span className="num mt-px text-sm font-semibold text-dev" aria-hidden>
        ✕
      </span>
      <div>
        <p className="label text-dev">Rejected</p>
        <p className="mt-1 text-sm leading-relaxed text-ink">{message}</p>
      </div>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <Card className="p-12 text-center text-sm leading-relaxed text-ink2">{children}</Card>;
}

/** A headline figure, optionally with its rail. */
export function Measure({
  label,
  value,
  sub,
  href,
  rail,
  tone = 'ink',
}: {
  label: string;
  value: ReactNode;
  sub?: string;
  href?: string;
  rail?: { pct: number | null; capped?: boolean };
  tone?: 'ink' | 'signal' | 'datum' | 'dev';
}) {
  const toneCls = { ink: 'text-ink', signal: 'text-signal', datum: 'text-datum', dev: 'text-dev' }[tone];
  const inner = (
    <Card className={`h-full p-4 ${href ? 'transition-colors hover:border-ink' : ''}`}>
      <p className="label text-ink3">{label}</p>
      <p className={`num mt-2.5 text-2xl font-semibold leading-none ${toneCls}`}>{value}</p>
      {rail && (
        <div className="mt-3">
          <ToleranceRail pct={rail.pct} capped={rail.capped} size="sm" />
        </div>
      )}
      {sub && <p className="mt-2.5 text-xs leading-relaxed text-ink2">{sub}</p>}
      {href && <p className="label mt-2.5 text-datum">open records →</p>}
    </Card>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

function LockIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-2.5 w-2.5" fill="currentColor" aria-hidden>
      <path d="M8 1a3.5 3.5 0 0 0-3.5 3.5V6H4a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1h-.5V4.5A3.5 3.5 0 0 0 8 1Zm2 5H6V4.5a2 2 0 1 1 4 0V6Z" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-2.5 w-2.5" fill="currentColor" aria-hidden>
      <path d="M6.2 11.8 2.7 8.3l1.1-1.1 2.4 2.4 6-6 1.1 1.1z" />
    </svg>
  );
}

function DocIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-2.5 w-2.5" fill="currentColor" aria-hidden>
      <path d="M4 1h5l4 4v10H4V1Zm4.5 1.5V6H12L8.5 2.5Z" />
    </svg>
  );
}

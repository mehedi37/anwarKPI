'use client';

import Link from 'next/link';

export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto max-w-xl border border-signal/40 bg-signal-soft p-6">
      <h1 className="text-lg font-bold text-signal">That action was rejected</h1>
      <p className="mt-2 text-sm text-signal">{error.message}</p>
      <div className="mt-4 flex gap-2">
        <button
          onClick={reset}
          className="border border-signal/40 bg-white px-3.5 py-2 text-sm font-semibold text-signal"
        >
          Try again
        </button>
        <Link
          href="/"
          className="border border-signal/40 bg-white px-3.5 py-2 text-sm font-semibold text-signal"
        >
          Back to overview
        </Link>
      </div>
    </div>
  );
}

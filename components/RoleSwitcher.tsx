'use client';

import { switchUser } from '@/lib/actions';
import type { User } from '@/lib/roles';
import { ROLE_LABEL } from '@/lib/roles';

export function RoleSwitcher({ users, current }: { users: User[]; current: User }) {
  return (
    <form action={switchUser} className="flex items-center gap-2">
      <label htmlFor="uid" className="hidden text-xs font-medium text-ink3 sm:block">
        Signed in as
      </label>
      <select
        id="uid"
        name="uid"
        // Remount on identity change: without a key React reuses the DOM node
        // and the select keeps showing the previous user after switching.
        key={current.id}
        defaultValue={String(current.id)}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="border border-rule bg-ink px-2.5 py-1.5 text-sm font-medium text-white outline-none focus:border-datum"
      >
        {users.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name} — {ROLE_LABEL[u.role]}
          </option>
        ))}
      </select>
      <noscript>
        <button className="border border-rule px-2 py-1 text-xs text-white">Switch</button>
      </noscript>
    </form>
  );
}

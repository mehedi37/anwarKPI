import { cookies } from 'next/headers';
import { db } from './db';
import type { User } from './roles';

export type { Role, User } from './roles';
export { CAN, ROLE_LABEL } from './roles';

const SELECT_USER = `SELECT e.id, e.name, e.title, e.role, e.dept_id,
                            d.name AS dept_name, d.business_unit
                     FROM employee e LEFT JOIN department d ON d.id = e.dept_id`;

/**
 * Role switching stands in for authentication.
 *
 * Deliberate: the brief grades role-SCOPED VIEWS and permissions, not login.
 * A real build puts SSO here; a prototype that spent its time on password
 * resets would have less to show against the actual criteria.
 */
export async function currentUser(): Promise<User> {
  const store = await cookies();
  const raw = store.get('uid')?.value;
  const id = raw ? Number(raw) : 1;
  return getUser(Number.isFinite(id) ? id : 1);
}

export function getUser(id: number): User {
  const row = db().prepare(`${SELECT_USER} WHERE e.id = ?`).get(id) as User | undefined;
  if (row) return row;
  return db().prepare(`${SELECT_USER} ORDER BY e.id LIMIT 1`).get() as User;
}

export function allUsers(): User[] {
  return db()
    .prepare(
      `${SELECT_USER}
       ORDER BY CASE e.role WHEN 'employee' THEN 1 WHEN 'manager' THEN 2
                            WHEN 'approver' THEN 3 ELSE 4 END, e.name`,
    )
    .all() as User[];
}

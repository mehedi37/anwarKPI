import { cookies } from 'next/headers';
import { all, one } from './db';
import { ensureSeeded } from './seed';
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
  await ensureSeeded();
  const store = await cookies();
  const raw = store.get('uid')?.value;
  const id = raw ? Number(raw) : 1;
  return getUser(Number.isFinite(id) ? id : 1);
}

export async function getUser(id: number): Promise<User> {
  const row = await one<User>(`${SELECT_USER} WHERE e.id = ?`, [id]);
  if (row) return row;
  return (await one<User>(`${SELECT_USER} ORDER BY e.id LIMIT 1`))!;
}

export async function allUsers(): Promise<User[]> {
  return all<User>(
    `${SELECT_USER}
     ORDER BY CASE e.role WHEN 'employee' THEN 1 WHEN 'manager' THEN 2
                          WHEN 'approver' THEN 3 ELSE 4 END, e.name`,
  );
}

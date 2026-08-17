/**
 * Roles, permissions and user shape — pure, no database access.
 *
 * Kept separate from session.ts so client components can import the permission
 * model without dragging the SQLite driver into the browser bundle.
 */

export type Role = 'employee' | 'manager' | 'approver' | 'hr';

export type User = {
  id: number;
  name: string;
  title: string;
  role: Role;
  dept_id: number | null;
  dept_name: string | null;
  business_unit: string | null;
};

/**
 * The permission matrix from the design doc, in one place.
 *
 * Two decisions worth defending: the person who ADJUSTS a score is not the
 * person who APPROVES it (separation of duties), and post-approval CORRECTION
 * belongs to HR rather than to management — so a correction is a controlled
 * process, not a privilege of seniority.
 */
export const CAN = {
  setupKpi: (u: User) => u.role === 'manager' || u.role === 'hr',
  enterActual: (u: User) => u.role === 'employee' || u.role === 'manager',
  review: (u: User) => u.role === 'manager' || u.role === 'approver',
  adjust: (u: User) => u.role === 'manager' || u.role === 'approver',
  approve: (u: User) => u.role === 'approver',
  correct: (u: User) => u.role === 'hr',
  dashboard: (u: User) => u.role !== 'employee',
} as const;

export const ROLE_LABEL: Record<Role, string> = {
  employee: 'Employee',
  manager: 'Manager / Reviewer',
  approver: 'Approver',
  hr: 'HR',
};

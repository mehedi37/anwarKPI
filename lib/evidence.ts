import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { db, EVIDENCE_DIR } from './db';
import type { User } from './roles';

/**
 * The single place evidence files are written to disk.
 *
 * Centralised on purpose: the filename on a multipart upload is attacker
 * controlled, and `path.join(dir, `${prefix}-${name}`)` collapses any `../`
 * segments the client supplies and escapes the directory entirely. Every write
 * path goes through here so that rule cannot be forgotten at one call site.
 */
export function storeEvidenceFile(originalName: string, data: Buffer | string): string {
  // Drop any directory component, then reduce to a charset with no separators
  // and no leading dots — so neither `../` nor a dotfile can survive.
  const base = path
    .basename(originalName)
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .replace(/^\.+/, '_')
    .slice(0, 80);

  // A CSPRNG, not Math.random(): the ref is the URL the file is fetched by, so
  // it must not be predictable from other refs. Authorisation is enforced on
  // retrieval as well — this is defence in depth, not the only control.
  const ref = `${crypto.randomUUID()}-${base || 'evidence'}`;

  const abs = path.resolve(EVIDENCE_DIR, ref);
  if (!abs.startsWith(path.resolve(EVIDENCE_DIR) + path.sep)) {
    throw new Error('Rejected an evidence filename that resolved outside the evidence directory.');
  }

  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  fs.writeFileSync(abs, data);
  return ref;
}

/**
 * Who may read a given evidence document.
 *
 * Evidence is performance-review material, so it follows the same routing as
 * the record it belongs to: the employee it is about, the reviewer and approver
 * it is routed to, and HR. A URL alone is not authorisation.
 */
export function canReadEvidence(viewer: User, fileRef: string): boolean {
  const row = db()
    .prepare(
      `SELECT a.employee_id, a.reviewer_id, a.approver_id
       FROM evidence e
       JOIN actual_entry ae ON ae.id = e.actual_entry_id
       JOIN kpi_assignment a ON a.id = ae.kpi_assignment_id
       WHERE e.file_ref = ?`,
    )
    .get(fileRef) as
    | { employee_id: number; reviewer_id: number; approver_id: number }
    | undefined;

  if (!row) return false;
  if (viewer.role === 'hr') return true;
  return [row.employee_id, row.reviewer_id, row.approver_id].includes(viewer.id);
}

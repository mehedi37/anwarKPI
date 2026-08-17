import crypto from 'node:crypto';
import path from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { one } from './db';
import type { User } from './roles';

const BUCKET = 'evidence';

let _supabase: SupabaseClient | null = null;

/**
 * Server-side only, service_role key. This bucket is private — the app
 * proxies every read through `canReadEvidence`, the same authorisation model
 * the local-filesystem version used, so the key must never reach the browser.
 */
function supabase(): SupabaseClient {
  if (_supabase) return _supabase;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set.');
  _supabase = createClient(url, key, { auth: { persistSession: false } });
  return _supabase;
}

/**
 * The single place evidence files are written.
 *
 * Centralised on purpose: the filename on a multipart upload is attacker
 * controlled. `path.basename` drops any directory component and the charset
 * filter removes everything but a safe alphabet, so the storage key can never
 * carry a path segment. Every write path goes through here so that rule
 * cannot be forgotten at one call site.
 */
export async function storeEvidenceFile(originalName: string, data: Buffer | string): Promise<string> {
  const base = path
    .basename(originalName)
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .replace(/^\.+/, '_')
    .slice(0, 80);

  // A CSPRNG, not Math.random(): the ref is the URL the file is fetched by, so
  // it must not be predictable from other refs. Authorisation is enforced on
  // retrieval as well — this is defence in depth, not the only control.
  const ref = `${crypto.randomUUID()}-${base || 'evidence'}`;

  const body = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
  const { error } = await supabase()
    .storage.from(BUCKET)
    .upload(ref, body, { contentType: 'application/octet-stream', upsert: false });
  if (error) throw new Error(`Evidence upload failed: ${error.message}`);
  return ref;
}

/** Returns null if the object does not exist, rather than throwing. */
export async function readEvidenceFile(ref: string): Promise<Buffer | null> {
  const { data, error } = await supabase().storage.from(BUCKET).download(ref);
  if (error || !data) return null;
  return Buffer.from(await data.arrayBuffer());
}

/** Used by the demo reset — clears every object so the bucket matches a fresh seed. */
export async function clearEvidenceBucket(): Promise<void> {
  const { data, error } = await supabase().storage.from(BUCKET).list();
  if (error || !data || data.length === 0) return;
  await supabase()
    .storage.from(BUCKET)
    .remove(data.map((f) => f.name));
}

/**
 * Who may read a given evidence document.
 *
 * Evidence is performance-review material, so it follows the same routing as
 * the record it belongs to: the employee it is about, the reviewer and approver
 * it is routed to, and HR. A URL alone is not authorisation.
 */
export async function canReadEvidence(viewer: User, fileRef: string): Promise<boolean> {
  const row = await one<{ employee_id: number; reviewer_id: number; approver_id: number }>(
    `SELECT a.employee_id, a.reviewer_id, a.approver_id
     FROM evidence e
     JOIN actual_entry ae ON ae.id = e.actual_entry_id
     JOIN kpi_assignment a ON a.id = ae.kpi_assignment_id
     WHERE e.file_ref = ?`,
    [fileRef],
  );

  if (!row) return false;
  if (viewer.role === 'hr') return true;
  return [row.employee_id, row.reviewer_id, row.approver_id].includes(viewer.id);
}

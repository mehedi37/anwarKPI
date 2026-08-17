import Anthropic from '@anthropic-ai/sdk';
import { all, now, one, run } from './db';
import { readEvidenceFile } from './evidence';

/**
 * The one AI feature in v1: evidence verification.
 *
 * The brief's #1 stated weakness is "approvals show a final number, but not
 * always the calculation behind it". An attached document nobody opens is not
 * evidence, it is a formality. So the system reads the attachment, extracts the
 * figure it actually supports, and cross-checks it against what the employee
 * typed. A disagreement becomes a flag for the reviewer.
 *
 * Governance, enforced structurally rather than by convention:
 *   - this module writes ONLY to ai_suggestion. It never touches `score`.
 *   - every suggestion carries a rationale and the model id.
 *   - accepting or overriding a flag is itself a logged review event.
 *   - with no API key configured the feature reports "not configured" rather
 *     than inventing a result, and the rest of the system is unaffected.
 */

export const MODEL = 'claude-opus-5';

export function aiConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

type Extraction = {
  found: boolean;
  value: number | null;
  quote: string;
  reasoning: string;
};

const SYSTEM = `You verify evidence attached to employee KPI submissions at a manufacturing group in Bangladesh.

You are given (a) a supporting document and (b) the figure an employee has claimed as their actual result.

Find the figure in the document that corresponds to the claimed result. Report what the document actually supports — not what the employee claimed. If the document contains several candidate figures (for example a gross total and a net total), choose the one that most directly answers the KPI, and say in your reasoning why you chose it and what the alternative was.

You are assisting a human reviewer, never replacing one. Do not judge the employee, do not recommend a score, and do not speculate about intent. Report only what the document says.`;

const SCHEMA = {
  type: 'object' as const,
  properties: {
    found: { type: 'boolean', description: 'Whether a corresponding figure was located.' },
    value: { type: ['number', 'null'], description: 'The figure the document supports, as a plain number.' },
    quote: { type: 'string', description: 'The line from the document containing that figure. Empty if not found.' },
    reasoning: { type: 'string', description: 'One or two sentences explaining the choice, for the reviewer to read.' },
  },
  required: ['found', 'value', 'quote', 'reasoning'],
  additionalProperties: false,
};

async function extract(
  files: { filename: string; mime: string; ref: string }[],
  kpiName: string,
  unit: string | null,
  claimed: number,
): Promise<Extraction> {
  const client = new Anthropic();

  const content: Anthropic.ContentBlockParam[] = [];

  for (const f of files) {
    const buf = await readEvidenceFile(f.ref);
    if (!buf) continue;

    if (f.mime === 'application/pdf') {
      content.push({
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: buf.toString('base64') },
        title: f.filename,
      });
    } else if (f.mime.startsWith('image/')) {
      content.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: f.mime as 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp',
          data: buf.toString('base64'),
        },
      });
    } else {
      content.push({
        type: 'text',
        text: `--- ${f.filename} ---\n${buf.toString('utf8').slice(0, 40_000)}`,
      });
    }
  }

  content.push({
    type: 'text',
    text: `KPI: ${kpiName}\nUnit: ${unit ?? 'n/a'}\nFigure the employee entered: ${claimed}\n\nWhat figure does the attached evidence actually support?`,
  });

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    system: SYSTEM,
    output_config: { format: { type: 'json_schema', schema: SCHEMA } },
    messages: [{ role: 'user', content }],
  });

  if (response.stop_reason === 'refusal') {
    throw new Error('The verification request was declined by the safety system.');
  }

  const text = response.content.find((b) => b.type === 'text');
  if (!text || text.type !== 'text') throw new Error('No response content returned.');
  return JSON.parse(text.text) as Extraction;
}

/** Tolerance for "these agree": 0.5% of the claimed figure. */
function agrees(claimed: number, found: number): boolean {
  const tolerance = Math.abs(claimed) * 0.005;
  return Math.abs(claimed - found) <= tolerance;
}

export async function verifyEvidence(kpiId: number): Promise<void> {
  const kpi = await one<{ id: number; name: string; unit: string | null; type: string }>(
    `SELECT id, name, unit, type FROM kpi_assignment WHERE id = ?`,
    [kpiId],
  );
  if (!kpi) return;

  const entry = await one<{ id: number; value: number | null }>(
    `SELECT id, value FROM actual_entry WHERE kpi_assignment_id = ? ORDER BY id DESC LIMIT 1`,
    [kpiId],
  );

  // Only numeric KPIs with a manual figure and at least one attachment are
  // checkable. Milestone and qualitative KPIs have no single number to verify.
  if (!entry || entry.value === null) return;
  if (kpi.type !== 'standard' && kpi.type !== 'inverse') return;

  const files = await all<{ filename: string; mime: string; ref: string }>(
    `SELECT filename, mime, file_ref AS ref FROM evidence WHERE actual_entry_id = ?`,
    [entry.id],
  );
  if (files.length === 0) return;

  const record = (
    status: 'match' | 'mismatch' | 'not_found' | 'error',
    extracted: number | null,
    rationale: string,
  ) =>
    run(
      `INSERT INTO ai_suggestion
       (kpi_assignment_id, type, status, extracted_value, claimed_value, rationale, model_id, created_at)
       VALUES (?, 'evidence_check', ?, ?, ?, ?, ?, ?)`,
      [kpiId, status, extracted, entry.value, rationale, MODEL, now()],
    );

  if (!aiConfigured()) {
    await record('error', null, 'AI verification is not configured (no ANTHROPIC_API_KEY set). The reviewer must check the attachment manually.');
    return;
  }

  try {
    const result = await extract(files, kpi.name, kpi.unit, entry.value);

    if (!result.found || result.value === null) {
      await record('not_found', null, result.reasoning || 'No corresponding figure could be located in the attached evidence.');
      return;
    }

    const rationale = `${result.reasoning}${result.quote ? `\n\nFrom the document: "${result.quote.trim()}"` : ''}`;
    await record(agrees(entry.value, result.value) ? 'match' : 'mismatch', result.value, rationale);
  } catch (err) {
    await record('error', null, `Verification could not be completed: ${(err as Error).message}`);
  }
}

export type Suggestion = {
  id: number;
  status: 'match' | 'mismatch' | 'not_found' | 'error';
  extracted_value: number | null;
  claimed_value: number | null;
  rationale: string;
  model_id: string;
  created_at: string;
  resolution: 'accepted' | 'overridden' | null;
  resolved_by_name: string | null;
};

export async function latestSuggestion(kpiId: number): Promise<Suggestion | null> {
  return (
    (await one<Suggestion>(
      `SELECT s.id, s.status, s.extracted_value, s.claimed_value, s.rationale,
              s.model_id, s.created_at, s.resolution, e.name AS resolved_by_name
       FROM ai_suggestion s LEFT JOIN employee e ON e.id = s.resolved_by
       WHERE s.kpi_assignment_id = ? ORDER BY s.id DESC LIMIT 1`,
      [kpiId],
    )) ?? null
  );
}

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export const DATA_DIR = path.join(process.cwd(), '.data');
export const EVIDENCE_DIR = path.join(DATA_DIR, 'evidence');

let _db: Database.Database | null = null;

export function db(): Database.Database {
  if (_db) return _db;

  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const conn = new Database(path.join(DATA_DIR, 'kpiflow.db'));
  conn.pragma('journal_mode = WAL');
  conn.pragma('foreign_keys = ON');
  migrate(conn);
  _db = conn;
  return conn;
}

/**
 * Eleven tables: the ten from the design doc, plus ai_suggestion.
 *
 * Two structural rules the whole audit story rests on:
 *   - `score` rows are versioned, never updated. An adjustment writes a NEW row
 *     that keeps the original calculated_pct alongside the adjusted final_pct.
 *   - `review_event` is append-only. Nothing in the app ever UPDATEs or DELETEs
 *     from it.
 */
function migrate(conn: Database.Database) {
  conn.exec(`
    CREATE TABLE IF NOT EXISTS department (
      id            INTEGER PRIMARY KEY,
      name          TEXT NOT NULL,
      business_unit TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS employee (
      id         INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      title      TEXT NOT NULL,
      dept_id    INTEGER REFERENCES department(id),
      manager_id INTEGER REFERENCES employee(id),
      role       TEXT NOT NULL CHECK (role IN ('employee','manager','approver','hr'))
    );

    CREATE TABLE IF NOT EXISTS period (
      id         INTEGER PRIMARY KEY,
      label      TEXT NOT NULL,
      type       TEXT NOT NULL CHECK (type IN ('month','quarter')),
      start_date TEXT NOT NULL,
      end_date   TEXT NOT NULL,
      status     TEXT NOT NULL CHECK (status IN ('open','closed'))
    );

    -- Target and weight live here, frozen when the period opens. There is no
    -- shared "KPI definition" table: the same KPI name means a different target
    -- for every employee and every period, so the assignment is the real unit.
    CREATE TABLE IF NOT EXISTS kpi_assignment (
      id           INTEGER PRIMARY KEY,
      employee_id  INTEGER NOT NULL REFERENCES employee(id),
      period_id    INTEGER NOT NULL REFERENCES period(id),
      name         TEXT NOT NULL,
      description  TEXT,
      type         TEXT NOT NULL CHECK (type IN ('standard','inverse','milestone','qualitative')),
      target       REAL,
      unit         TEXT,
      weight       REAL NOT NULL,
      reviewer_id  INTEGER NOT NULL REFERENCES employee(id),
      approver_id  INTEGER NOT NULL REFERENCES employee(id),
      state        TEXT NOT NULL DEFAULT 'draft'
                   CHECK (state IN ('draft','submitted','under_review','returned','approved','corrected')),
      locked_by    INTEGER REFERENCES employee(id),
      locked_at    TEXT,
      created_at   TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS rubric_level (
      id                INTEGER PRIMARY KEY,
      kpi_assignment_id INTEGER NOT NULL REFERENCES kpi_assignment(id),
      level             INTEGER NOT NULL,
      label             TEXT NOT NULL,
      criteria_text     TEXT NOT NULL,
      achievement_pct   REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS milestone (
      id                INTEGER PRIMARY KEY,
      kpi_assignment_id INTEGER NOT NULL REFERENCES kpi_assignment(id),
      title             TEXT NOT NULL,
      sub_weight        REAL NOT NULL,
      due_date          TEXT NOT NULL,
      completed_date    TEXT
    );

    -- The source column is the provenance rule: system-pulled figures carry
    -- their source, manual figures are blocked at submit without evidence.
    CREATE TABLE IF NOT EXISTS actual_entry (
      id                INTEGER PRIMARY KEY,
      kpi_assignment_id INTEGER NOT NULL REFERENCES kpi_assignment(id),
      value             REAL,
      rubric_level      INTEGER,
      source            TEXT NOT NULL CHECK (source IN ('system','manual')),
      source_detail     TEXT,
      comment           TEXT,
      reported_by       INTEGER NOT NULL REFERENCES employee(id),
      reported_at       TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS evidence (
      id              INTEGER PRIMARY KEY,
      actual_entry_id INTEGER NOT NULL REFERENCES actual_entry(id),
      filename        TEXT NOT NULL,
      file_ref        TEXT NOT NULL,
      mime            TEXT NOT NULL,
      uploaded_by     INTEGER NOT NULL REFERENCES employee(id),
      uploaded_at     TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS score (
      id                INTEGER PRIMARY KEY,
      kpi_assignment_id INTEGER NOT NULL REFERENCES kpi_assignment(id),
      calculated_pct    REAL,
      final_pct         REAL,
      formula_version   TEXT NOT NULL,
      formula           TEXT NOT NULL,
      inputs_json       TEXT NOT NULL,
      cap_applied       INTEGER NOT NULL DEFAULT 0,
      adjusted          INTEGER NOT NULL DEFAULT 0,
      reason            TEXT,
      is_current        INTEGER NOT NULL DEFAULT 1,
      created_by        INTEGER REFERENCES employee(id),
      created_at        TEXT NOT NULL
    );

    -- Append-only. This IS the audit trail.
    CREATE TABLE IF NOT EXISTS review_event (
      id                INTEGER PRIMARY KEY,
      kpi_assignment_id INTEGER NOT NULL REFERENCES kpi_assignment(id),
      actor_id          INTEGER NOT NULL REFERENCES employee(id),
      action            TEXT NOT NULL CHECK (action IN
                          ('assign','submit','review','return','adjust','approve','correct','ai_accept','ai_override')),
      reason            TEXT,
      prev_score_id     INTEGER REFERENCES score(id),
      new_score_id      INTEGER REFERENCES score(id),
      at                TEXT NOT NULL
    );

    -- The AI layer writes ONLY here. It never writes to score.
    CREATE TABLE IF NOT EXISTS ai_suggestion (
      id                INTEGER PRIMARY KEY,
      kpi_assignment_id INTEGER NOT NULL REFERENCES kpi_assignment(id),
      type              TEXT NOT NULL CHECK (type IN ('evidence_check')),
      status            TEXT NOT NULL CHECK (status IN ('match','mismatch','not_found','error')),
      extracted_value   REAL,
      claimed_value     REAL,
      rationale         TEXT NOT NULL,
      model_id          TEXT NOT NULL,
      created_at        TEXT NOT NULL,
      resolved_by       INTEGER REFERENCES employee(id),
      resolved_at       TEXT,
      resolution        TEXT CHECK (resolution IN ('accepted','overridden'))
    );
  `);
}

export function now(): string {
  return new Date().toISOString();
}

/** Close the connection so the data directory can be removed and reseeded. */
export function closeDb() {
  if (_db) {
    _db.close();
    _db = null;
  }
}

export function isSeeded(): boolean {
  const row = db().prepare(`SELECT COUNT(*) AS n FROM employee`).get() as { n: number };
  return row.n > 0;
}

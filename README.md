# Anwar KPIFlow
A first version of a variable-KPI system where every score can be traced back to a target, an actual result, supporting evidence, and an accountable approval.

Built for the Anwar Group technology-selection assignment. Demo data only. People and BDT figures are fictional.

---

## Submission

| | |
|---|---|
| **Live prototype** | [anwarkpi.onrender.com](https://anwarkpi.onrender.com/) — role switcher in the header, no login needed.|
| **Slide deck** | Problem understanding, UI/UX walkthrough and technical design |
| **Demo video** | Short walkthrough of the main workflow — [Google Drive link](https://drive.google.com/file/d/1QupaP_S6ES-pHwzX8_m4kEWSMaN2BWjM/view?usp=sharing) |

Render's free tier spins down when idle, so the first load after inactivity can take 30–60 seconds to wake up.

---

## Run it

```bash
npm install
cp .env.example .env   # fill in DATABASE_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
npm run build && npm start     # http://localhost:3000
# or: npm run dev
```

State lives in Supabase, not on local disk, so `DATABASE_URL` (Postgres connection string), `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (for the private evidence bucket) are required — the app throws on startup without `DATABASE_URL`. Use the **Transaction pooler** connection string (port 6543), not the Session pooler (5432): dashboard and record pages fan out several queries concurrently, and Session mode holds a backend connection for a client's whole lifetime, which exhausts the free tier's small shared pool fast. The database schema and demo data seed themselves on first request once connected — there is no migration step.

`ANTHROPIC_API_KEY` is optional and only needed to exercise the AI evidence check:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

Without a key the app runs normally and the evidence check reports that it is not configured, rather than inventing a result.

```bash
npm test        # 17 checks against the scoring engine
```

---

## Sign in as any of the four personas

There is no login. The header has a role switcher, because the brief grades **role-scoped views and permissions**, not authentication. Every persona is one click away:

| Person | Role | What they can do |
|---|---|---|
| **Rafiq Ahmed** | Employee | Record results, attach evidence, see their own summary |
| **Kamrul Islam** | Manager / Reviewer | Set up KPIs, review, return for clarification, adjust with a reason |
| **Mahbub Rahman** | Approver | Final approval — the action that locks a record |
| **Ayesha Siddiqua** | HR | The authorised correction process, the only route past a lock |

Nasrin Sultana, Tanvir Hossain and Shirin Akter are additional employees whose records populate the dashboard.

---

## The demo path

The seven steps from the brief, end to end. Rafiq's **Monthly Sales** KPI for August 2026 is deliberately left unrecorded so the whole flow can be walked.

1. **KPI assigned** — as *Kamrul Islam*, see **KPI setup**. (Monthly Sales is already assigned; the form is there to show setup.)
2. **Actual entered** — as *Rafiq Ahmed*, **My KPIs → Monthly Sales → Record result**. Enter `9000000`.
3. **Evidence attached** — tick *August Sales Report (as circulated 01 Sep)*. Try submitting **without** it first: the submission is rejected, because manual entries require evidence.
4. **Score calculated** — 9,000,000 ÷ 10,000,000 × 100 = **90%**, weighted at 30% = 27 points.
5. **Manager reviews** — as *Kamrul Islam*, **Review queue**. The attached report nets to BDT 8.4m after cancellations, so adjust to `84` with a reason. The calculated 90% is preserved beside it.
6. **Approval completed** — as *Mahbub Rahman*, **Approvals → Approve and lock**. Every edit control disappears.
7. **Dashboard updated** — **Management dashboard**: the adjustment appears under *Scores manually adjusted*, with its reason and author.

Then, optionally: as *Ayesha Siddiqua*, apply a **correction** to the locked record. It does not overwrite anything — a third score version is written and all three stay visible.

**Reset demo data** on the Overview page restores the seeded state so the walkthrough can be run again.

---

## Screens

| # | Screen | Route |
|---|---|---|
| 1 | KPI setup | `/setup` |
| 2 | Target vs actual reporting | `/my-kpis` |
| 3 | Evidence submission | `/kpi/[id]/submit` |
| 4 | Manager review | `/review` |
| 5 | Approval | `/approve` |
| 6 | Employee summary | `/summary` |
| 7 | Management dashboard | `/dashboard` |
| + | Record detail and audit trail | `/kpi/[id]` |

The audit trail is not in the brief's list of screens, but "audit and control design" is a graded criterion, so it is a visible timeline on every record rather than a table described in prose.

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  Next.js app — role-scoped server-rendered views    │
│  Employee · Manager · Approver · HR                 │
└───────────────────────┬─────────────────────────────┘
                        │  server actions
┌───────────────────────▼─────────────────────────────┐
│  Application layer                                  │
│  ┌───────────────┬──────────────┬────────────────┐  │
│  │ Scoring       │ Workflow &   │ Reporting      │  │
│  │ engine        │ audit        │ queries        │  │
│  │ lib/scoring   │ lib/actions  │ lib/queries    │  │
│  └───────────────┴──────────────┴────────────────┘  │
└──────┬──────────────────────────┬───────────────────┘
       │                          │
┌──────▼──────────┐   ┌───────────▼───────────────────┐
│  Postgres       │   │  Evidence file store          │
│  11 tables      │   │  Supabase Storage (private)   │
└─────────────────┘   └───────────────────────────────┘
       ▲
       │  reads evidence + records, writes suggestions ONLY
┌──────┴──────────────────────────────────────────────┐
│  AI assist — lib/ai.ts                              │
│  Claude API · writes to ai_suggestion, never score   │
│  v1 is fully usable with this switched off           │
└─────────────────────────────────────────────────────┘
```

Postgres (Supabase) and Supabase Storage hold all state — an append-only audit trail and versioned scores need real transactional integrity and foreign keys, and both survive restarts and redeploys, unlike anything written to Render's local disk. The app connects with a direct Postgres connection string and the Supabase service_role key; it does not use Supabase Auth or the client-side Data API, so Postgres RLS is enabled with no policies (deny by default) as defense in depth.

### Data model

Eleven tables. `lib/db.ts` holds the schema with the reasoning inline.

| Table | Purpose |
|---|---|
| `department`, `employee` | Org context and the four roles |
| `period` | Month or quarter; targets and weights freeze when it opens |
| `kpi_assignment` | The unit of work — employee × KPI × period, carrying target, weight, type, routing and state |
| `rubric_level` | Qualitative KPIs: levels with written criteria, each mapped to a fixed % |
| `milestone` | Milestone KPIs: dated deliverables with sub-weights |
| `actual_entry` | The recorded result, tagged `system` or `manual` |
| `evidence` | Attachments; required when the entry is manual |
| `score` | **Versioned** — a new row per calculation or adjustment, never updated in place |
| `review_event` | **Append-only** — this is the audit trail |
| `ai_suggestion` | Everything the AI layer produces; isolated from scoring |

### Roles and permissions

`lib/roles.ts` is the single source of truth, enforced in server actions rather than only hidden in the UI.

| Action | Employee | Manager | Approver | HR |
|---|---|---|---|---|
| Set up KPI, target, weight | — | ✅ | — | ✅ |
| Enter actual + evidence | ✅ | ✅ | — | — |
| Review / return for clarification | — | ✅ | ✅ | — |
| Manual adjustment (reason required) | — | ✅ | ✅ | — |
| Final approve (locks record) | — | — | ✅ | — |
| Authorised correction post-lock | — | — | — | ✅ |
| Management dashboard | — | ✅ | ✅ | ✅ |

Two deliberate choices: the person who **adjusts** a score is not the person who **approves** it, and post-approval **correction** belongs to HR rather than to management — so a correction is a controlled process, not a privilege of seniority.

### Audit approach

- `review_event` is append-only. No code path in the app updates or deletes from it.
- A manual adjustment writes a **new** `score` row that keeps the original `calculated_pct` beside the adjusted `final_pct`, plus the mandatory reason.
- Approval sets `state = approved` and stamps `locked_by` / `locked_at`. There is no edit affordance anywhere in the UI for a locked record.
- Correction writes a further version linked to the approved one. All versions remain visible.
- "What was the original score, what is it now, who changed it and why" is a single join.

### Evidence handling

Evidence documents are performance-review material, so they are treated as access-controlled records rather than static files:

- **All writes go through `lib/evidence.ts`.** A multipart upload's filename is attacker controlled, and `path.join(dir, prefix + name)` collapses `../` segments and escapes the directory. The helper strips the directory component, reduces the name to a safe charset, and asserts the resolved path is still inside the evidence directory before writing. Every write path — uploads, sample documents, and the seed — uses it, so the rule cannot be missed at one call site.
- **Stored names use `crypto.randomUUID()`**, not `Math.random()`, since the reference is also the retrieval URL.
- **Retrieval is authorised, not just unguessable.** `GET /evidence/[ref]` resolves the document back to its KPI and allows only the employee it concerns, the reviewer and approver it is routed to, and HR. Anyone else gets a 404 rather than a 403, so the response does not confirm the document exists. Responses are `private, no-store`.

### Reporting approach

Every dashboard figure is computed on read from the same normalised tables — no summary store to drift out of sync — and every tile drills through to the records underneath it. At a few thousand records per period that is the right trade; a materialised layer can go behind the same queries later without touching the schema.

Read paths are optimised for round trips, not just for query shape, since each one costs real latency over a pooled connection: `getRecord` (`lib/queries.ts`) assembles a record plus its period, latest entry, rubric, milestones, full score history, evidence and AI suggestion in **one query** via `LATERAL` joins and `json_agg`, rather than the ~7 sequential queries that would otherwise run once per row on every list and dashboard page. The employee summary page fetches each period's totals once and reuses them for the current, previous and trend-row views, instead of recomputing the same period repeatedly.

---

## The scoring engine

`lib/scoring.ts` is pure functions with no I/O, which is why it can be tested directly (`npm test`). Four KPI types, one engine:

| Type | Formula |
|---|---|
| Standard (higher is better) | `Actual ÷ Target × 100` |
| Lower is better | `(2 − Actual ÷ Target) × 100` |
| Milestone | weight of milestones on time ÷ weight due this period × 100 |
| Qualitative | rubric level → fixed % (100 / 85 / 70 / 50 / 25) |

Final score = `Σ(achievement% × weight)`, weights totalling 100%.

The decisions worth defending are the edge cases, and each has a test:

- **Lower-is-better is not `Target ÷ Actual`.** That is the obvious inversion and it is wrong: zero defects is a *perfect* result and divides by zero. `(2 − Actual/Target)` handles zero cleanly and is linear, so equal misses cost the same either side of target. Tanvir Hossain's Defect Rate is seeded at exactly zero to show this.
- **Cap and floor at [0%, 120%].** Without a floor, one badly overshot inverse KPI returns −200% and wipes out an employee's whole weighted total. Without a cap, a single 400% outlier hides real misses. The UI says "capped at 120%" rather than silently altering the number.
- **Pending is not zero.** A KPI with no result is excluded from averages, not scored as zero — otherwise every dashboard reports a fake collapse whenever a period opens.
- **Target = 0 is rejected at setup**, not handled at scoring time. A zero target means the KPI should have been a milestone or qualitative one.
- **The formula is stored with the score** (`formula_version`, `inputs_json`), so a historical score can be recomputed and explained after the rules change.

---

## The AI layer

One feature, chosen because it attacks the brief's own stated weakness — *"approvals show a final number, but not always the calculation behind it"*. An attached document nobody opens is not evidence; it is a formality.

**Evidence verification.** On submission, the attachment is read and the figure it supports is extracted and compared with the figure the employee typed. A disagreement is flagged for the reviewer. Claude reads PDFs and images natively, so this is one API call rather than an OCR stage plus an LLM stage.

Governance is structural, not a promise:

- `lib/ai.ts` writes **only** to `ai_suggestion`. It cannot touch `score`.
- Every suggestion carries a rationale and the model id, shown to the reviewer.
- Accepting or overriding a flag is itself a logged `review_event`.
- With no API key the feature reports that it is unconfigured. It never fabricates a result, and nothing else in the system changes.

Deliberately **not** built: anomaly detection (needs several periods of history to have signal — noise at launch), natural-language KPI setup and dashboard Q&A (convenience, not objectivity), and anything that scores, ranks or compares employees excluded by the brief and against the design principle.
# Anwar KPIFlow — working prototype

A first version of a variable-KPI system where every score can be traced back to a target, an actual result, supporting evidence, and an accountable approval.

Built for the Anwar Group technology-selection assignment. Demo data only — people and BDT figures are fictional.

---

## Run it

```bash
npm install
npm run build && npm start     # http://localhost:3000
# or: npm run dev
```

The database seeds itself on first request — there is no setup step. To exercise the AI evidence check, set a key before starting:

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
│  SQLite         │   │  Evidence file store          │
│  11 tables      │   │  .data/evidence/              │
└─────────────────┘   └───────────────────────────────┘
       ▲
       │  reads evidence + records, writes suggestions ONLY
┌──────┴──────────────────────────────────────────────┐
│  AI assist — lib/ai.ts                              │
│  Claude API · writes to ai_suggestion, never score   │
│  v1 is fully usable with this switched off           │
└─────────────────────────────────────────────────────┘
```

SQLite stands in for PostgreSQL so the prototype runs with no external service. The schema is ordinary relational SQL and moves across unchanged; the choice of a relational store is not incidental — an append-only audit trail and versioned scores need real transactional integrity and foreign keys.

This does mean the app needs a writable disk, so it will not run on Vercel as-is. See [DEPLOYMENT.md](./DEPLOYMENT.md) for the options and the recommended host.

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

Deliberately **not** built: anomaly detection (needs several periods of history to have signal — noise at launch), natural-language KPI setup and dashboard Q&A (convenience, not objectivity), and anything that scores, ranks or compares employees — excluded by the brief and against the design principle.

---

## Visual direction

**A score is a measurement, not an opinion** — and the interface argues that.

- **The tolerance rail** is the signature. Every achievement figure is drawn on a track running 0 to the 120% cap, with a tick marking the target. The fill colour says which side of the datum the result landed on, the hard stop at the right edge shows the cap being applied, and an unmeasured KPI draws as a *hatched empty track* rather than a bar at zero — so "pending is not zero" is something you can see, not just something the README claims. It replaces every progress bar and stat-tile sparkline in the app.
- **Colour is a deviation scale, not a traffic light.** Teal reads "at or above the datum", oxide "below it", ochre "not measured yet", indigo "locked or corrected". Green-for-good and red-for-bad would smuggle a judgement into what is meant to be an arithmetic result.
- **Two typefaces with sharp roles.** Space Grotesk carries the interface; IBM Plex Mono carries every figure, so targets, actuals, percentages and BDT amounts all read as instrument values. Both are self-hosted at build time by `next/font` — no runtime CDN request.
- **The ground is drafting paper** — a two-level grid at very low contrast — and cards are square-cornered measurement sheets on top of it.
- **The overview leads with a finished measurement**, not a welcome: one real record with the actual value satisfying each link in its chain.

Quality floor: responsive to 390px, visible keyboard focus, `prefers-reduced-motion` respected.

## What this is not

The brief says this is not a full HRMS, so:

- No payroll, attendance, recruitment or learning management
- No employee, department or org-chart administration — people are seeded
- No authentication — roles switch from the header
- No notifications, no mobile app, no configurable multi-level approval routing
- No live ERP integration — `source = 'system'` entries are seeded to show the provenance model; one scheduled CSV import would replace them without changing anything else

Everything on that list can be added without changing the data model, which is the actual claim being made about the design.

## Known limitations

- SQLite and local file storage suit a single-instance prototype; a deployment with more than one instance needs PostgreSQL and object storage. The schema and queries are unchanged by that swap.
- The AI evidence check has been written against the documented API and its unconfigured path is verified, but the live call was not exercised in the build environment (no API key available there).
- Milestone completion is captured on the submission form by position, which is fine for a fixed milestone list and would need stable ids if milestones became editable after assignment.
- Evidence retrieval is authorised (see above), but **record pages themselves are not scoped** — any signed-in role can open `/kpi/[id]` for any record. That is deliberate for a demo where you switch personas to walk the flow, and it is the first thing to close in a real deployment: the same routing check used for evidence applies directly to `getRecord`.
- Identity comes from an unsigned `uid` cookie, because there is no authentication. Every permission check is real and enforced server-side, but the identity behind it is self-asserted — so treat the permission model as demonstrated, not as deployed.

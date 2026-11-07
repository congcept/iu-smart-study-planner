# Next initiatives and thesis schedule — 7 Nov 2026 → 26 Mar 2027

This is a dated snapshot of the working plan. It is kept in the repository so the schedule survives
outside a single conversation; the live version is edited as dates slip.

Derived from the audit (`docs/current-data-and-inputs-audit.md`), the recap
(`docs/october-2026-recap.md`), the thesis sources under `documentation/thesis/`, the IU format
guideline (`Thesis_Format_Guideline.docx`), and the shipped code.

**Decisions you already made:** admin-only reference assignment with `/admin` UI; engineering
evidence accepted as the evaluation chapter; local Docker demo only; feature freeze after the
3 December check.

---

## 1. Deadline map

| Date (from your schedule) | Milestone                               | What must be true                                                 |
| ------------------------- | --------------------------------------- | ----------------------------------------------------------------- |
| 03/12/2026                | Faculty progress check (item 8)         | Demonstrable system + short status report + rehearsed walkthrough |
| 31/12/2026                | Implementation window closes (item 7)   | Feature freeze already in effect since 03/12                      |
| 04/01–08/01/2027          | Thesis submitted to department (item 9) | Complete, format-compliant reading copy                           |
| 11/01–29/01/2027          | Review / assessment (item 10)           | Corrections buffer, no new work                                   |
| 19/02/2027                | Council establishment CV (item 12)      | Administrative, no engineering                                    |
| 08/03–26/03/2027          | Defense (item 13)                       | Slides, demo, rebuttal prep                                       |

Today is 7 Nov 2026: **~3.5 weeks to the progress check, ~8.5 weeks to submission.**

## 2. What I verified (the baseline this plan rests on)

- `documentation/thesis/` is **5,873 words across 7 chapters** and describes the June prototype:
  React Flow (deleted, decision D2), localStorage persistence (replaced by cookie auth +
  server-backed progress), "no authentication" listed as a limitation, ratings listed as future
  work, `86 courses`, "tests for the Button component", 1 ms BFS. That is wrong in
  `00-abstract`, `02-literature-review`, `03-methodology`, `04-implementation`, `05-results`,
  `06-conclusion`, both appendices, and the 10-entry bibliography.
- The IU guideline caps the **main text at 50 pages** (no minimum), double-spaced, 1.5"/1" margins,
  Times 12. Current length is well under that — so this is a **correctness** job, not a padding job.
- Nothing in production code writes `User.curriculumId`. Every `curriculumId` write is a test
  fixture. `register`/`create user` schemas reject the field; no `PATCH /users/:id` exists;
  the demo upsert uses `update: {}`. `GET /api/users` (admin) does not even select `curriculumId`.
- Every context reader already exists and is tested; they are gated only by that one column.
  `listCurriculumContexts()` already returns `usage: 'REFERENCE_ONLY'`
  (`server/src/services/curriculumContexts.ts:25`).
- `GET /api/curricula` and `GET /api/curricula/:id` are public and unauthenticated
  (`server/src/routes/curricula.ts`).
- Established write pattern to copy: role re-read `FOR SHARE` held through commit inside a
  Serializable transaction with bounded retries — `server/src/services/schoolResources.ts`,
  `courseRatings.ts:131`, `semesterAllocationStorage.ts:103`.
- Established client pattern to copy: `client/src/features/admin/adminSession.ts`
  (`useVerifyAdminSession`) + generation/busy guards + tab recovery journals.

**Consequence:** the highest-leverage feature left is not a new capability. It is making 40+
already-shipped PRs visible by giving `User.curriculumId` a legitimate, honestly-labelled writer.

---

## 3. Initiative A — Reference curriculum assignment (the only new feature)

**Goal:** an ADMIN can attach or clear a _reference_ curriculum on a STUDENT account, so the
contextual read-only views, contextual planner preview and the admin cohort diagnostics become
demonstrable. This is a **simulation reference assignment**, not cohort activation, not
institutional validation, and it does not enable assigned-context editing.

### A1 — Server contract (PR 1)

**Shared** — `shared/src/schemas/index.ts`, `shared/src/dto/index.ts`:

- `AssignReferenceCurriculumSchema` (strict): `{ userId: uuid, curriculumId: uuid | null,
expectedCurriculumId: uuid | null, requestId: uuid }`.
  - `curriculumId: null` means clear.
  - `expectedCurriculumId` is the compare-and-swap precondition.
  - `requestId` is an account-scoped retry key, matching the write conventions already in use.
- `ListAssignableStudentsSchema` (strict): optional `cursor` (uuid), bounded page size.
- DTOs: `AdminStudentSummaryDTO` `{ id, studentId, name, email, curriculumId,
curriculum: { id, code, name } | null }` and `ReferenceAssignmentDTO`
  `{ userId, curriculumId, usage: 'REFERENCE_ONLY', changedAt }`.

**Service** — new `server/src/services/curriculumAssignment.ts`:

- `listAssignableStudents(actorUserId, query)`
  - fresh `FOR SHARE` actor role read; 403 if no longer ADMIN
  - `role: 'STUDENT'` only, ordered by `studentId`, hard page limit (50) + id cursor
  - joins the assigned curriculum for `id/code/name` only
- `assignReferenceCurriculum(actorUserId, input)`
  - one Serializable transaction, bounded retries on 40001/40P01/deadlock (same helper shape as
    `schoolResources.ts`)
  - actor `role` re-read `FOR SHARE` **and held through commit**; demotion → 403
  - target user loaded `FOR UPDATE`; `role !== 'STUDENT'` → 403 (admins cannot be assigned)
  - `expectedCurriculumId !== user.curriculumId` → 409, no rebase, no replay
  - `curriculumId !== null` and not found → 404
  - identical repeat (`curriculumId === current`) → 200 with `changed: false`; this is naturally
    idempotent, so no receipt table is needed
  - writes **only** `users.curriculum_id`. No `StudentRecord`, `GradeAttempt`, `CourseRating`,
    `StudyPlan`, `ReferenceSelectionReceipt` or `SchoolResource` is created, changed or deleted.
    Existing records stay exactly as they are; nonmembers simply appear as preserved history,
    which `studentAccountViews.ts` already handles.

**Route** — new `server/src/routes/adminUsers.ts`, mounted in `server/src/index.ts` **before**
`/api/admin`:

- `GET  /api/admin/users/students` → `requireAdmin`
- `POST /api/admin/users/students/:userId/curriculum` → `requireAdmin`

Follow the existing route conventions: `z.object({}).strict().parse(req.query)` /
`req.body` on reads, `req.userId` guard, `failure()` mapping of `ZodError` → 400 and a service
error class → its status.

**Tests** — new `server/src/__tests__/adminCurriculumAssignment.test.ts` (real PostgreSQL):

- 401 unauthenticated, 403 non-admin, 403 demoted-mid-transaction actor
- 403 target is ADMIN, 404 unknown target, 404 unknown curriculum
- 409 on stale `expectedCurriculumId`; 200 `changed:false` on an already-matching repeat
- assign → clear → assign round trip
- assignment appears in `GET /api/auth/me` for the target account (`authCurriculumContext.test.ts`
  extension)
- **evidence preservation:** after assignment, the target's `StudentRecord`, `GradeAttempt`,
  `CourseRating` and `StudyPlan` counts and bytes are unchanged
- concurrent assignment races resolve to one winner with bounded retries
- list endpoint is bounded, STUDENT-only, and hides non-owned identity fields

Also extend `server/src/__tests__/adminResources.test.ts` only if route mounting changes its
expectations (it should not).

### A2 — `/admin` panel (PR 2)

- `client/src/lib/curriculumApi.ts`: add `listCurricula()` (typed against `CurriculumSummaryDTO`)
- new `client/src/lib/adminUsersApi.ts`: `listAssignableStudents`, `assignReferenceCurriculum`,
  both with strict runtime validation of ids/usage, and fresh session confirmation before **and**
  after both successful and failed calls
- new `client/src/features/admin/ReferenceAssignmentPanel.tsx`:
  - no write on mount; explicit **Apply assignment** / **Clear assignment** buttons only
  - `useVerifyAdminSession(adminUserId, { requireUuid: true })` before each write and after each reply
  - account-keyed remount + generation guard; a stale reply from a previous admin must not render
  - pending state locks the controls; failed writes keep the original request visible for retry
  - required copy: _"This attaches a reference curriculum for demonstration. It does not activate a
    verified cohort, does not validate graduation or elective rules, and does not make the assigned
    curriculum editable. The student's existing records are preserved and those outside this
    curriculum appear as history."_
  - and the warning that matters operationally: _"An assigned account loses access to the legacy
    editable curriculum map and its progress store becomes read-only."_
- mount as a new section in `client/src/features/admin/AdminResourceDashboard.tsx` (608 lines;
  keep it a sibling section, do not restructure)
- tests: `ReferenceAssignmentPanel.test.tsx` (states, stale replies, session loss, no auto-write),
  `AdminReferenceAssignmentIntegration.test.tsx`, `adminUsersApi.test.ts`

### Explicitly **not** in Initiative A

No assigned-context editing, no completion/claim transfer, no context-keyed browser cache
activation, no prerequisite validation of existing records, no institutional validation flag, no
seed change. Each stays recorded as future work in `06-conclusion.tex`.

---

## 4. Initiative B — Demonstration scenario and walkthrough

Small, documentation-first; no new write path.

- `docs/phase-5/demo-scenario.md`: the exact declared scenario — accounts
  (`demo-student@example.test` unassigned → legacy map; `demo.populated@example.test` assigned →
  contextual views; `demo-school-admin@example.test`), the `CS-REFERENCE` curriculum, one
  labelled simulated resource configuration, and which saved plan is shown. Every number is
  labelled a simulation assumption, not a university fact.
- `docs/phase-5/demo-walkthrough.md`: ordered click path with what to say at each step, and the
  one-sentence honesty caveat for each screen. This doubles as the progress-check script.
- `docs/october-2026-recap.md` stays untouched as a historical document; the walkthrough is the
  operational view.
- Rehearse end-to-end against Docker PostgreSQL at 1280 and 390 px before 03/12.

---

## 5. Initiative C — Thesis re-baseline (runs in parallel with A, starts this week)

**C1 — Correctness pass on the three chapters that contradict the code** (do first; it removes
the false-claim risk)

- `chapters/00-abstract.tex` — rewrite around the shipped system: cookie accounts and account
  scope, per-curriculum context model, immutable numeric attempts with highest-score
  credit-weighted GPA, completion-gated Bayesian difficulty, the atomic saved-selection editor with
  receipts/drafts/blockers, and the simulated admin allocation stack. State the reference-only
  boundary in the last sentence.
- `chapters/06-conclusion.tex` — replace the 7 contributions with ~6 that match `main`; replace
  limitations with the true ones: no verified cohort, no calendar/offering data, no assigned-context
  editing, unverified subject/category metadata, no deployment, no user study, simulated scope;
  replace future work (multi-major source reconciliation, calendar validity, deployment, evaluation).
- `chapters/05-results.tex` — delete every invented metric (200 ms fetch, 5–10 ms toggles, 1 ms
  BFS, 60 fps, "tests for the Button component"). Replace with the real evidence base, re-verified
  immediately before quoting: 2,989 server tests across 109 suites on disposable PostgreSQL,
  2,507 client tests, 10 startup lifecycle cases, the single Ubuntu CI gate, the two profilers with
  their documented excluded latency, the browser accessibility audit, and a scenario walkthrough.

**C2 — Implementation chapter (4) rewrite** (~2,500–3,500 words) — the real architecture: monorepo
and shared Zod contracts, 23 models / 6 enums, per-curriculum placement and prerequisite edges,
scope preconditions inside Serializable transactions, immutable attempts and receipts, the frozen
versioned simulation contracts, and the recovery journals. This is the largest writing job.

**C3 — Chapters 1–3 alignment** — research questions and contributions that match what shipped;
methodology as design-science iterations with the evidence standard (fail-first tests, real
database, independent review, nothing weakened); literature review re-sourced away from React Flow
and localStorage toward curriculum sequencing, prerequisite graphs, course timetabling, Bayesian
shrinkage, and accessibility.

- `thesis.tex` bibliography must drop `reactflow2023` and the localStorage framing, and gain real
  citations (Bayesian shrinkage / empirical-Bayes priors, curriculum sequencing, timetabling
  allocation, WCAG/axe, design science).

**C4 — Claims ledger** — new `documentation/thesis/claims-ledger.md`: every factual and numeric
claim in the thesis mapped to its evidence (file path, PR number, CI run, doc). This is the cheap
guard against the drift that produced the current state, and it is reusable at the defense.

**C5 — Figures** — the three existing figures are of the legacy map. Keep them for the legacy path
and add real captures of the shipped screens (assigned reference view, planner preview, grades GPA
and distribution, admin allocation preview, saved-selection editor). Consistency: one viewport,
one seed, captions that name the scenario.

---

## 6. Initiative D — Progress-check package (by 03/12)

- `docs/phase-5/progress-report-2026-12-03.md`: objectives, what is built, the architecture in one
  page, the evidence, what is deliberately not built and why, and the plan to 04/01. No new claims.
- The rehearsed walkthrough from Initiative B.
- Evidence bundle: CI run link for the merged head, current test counts, the profiler reports, the
  accessibility results.

**Feature freeze takes effect here.** After 03/12: documentation, defect fixes and demo polish only.

---

## 7. Initiative E — Evaluation chapter (engineering evidence)

Per your decision, this is evidence, not a user study. Sections:

1. **Verification scale and what it protects** — grouped by risk (transactional cascades, scope
   isolation, retry/recovery, corruption rejection), with the fail-first practice described.
2. **Reproducibility** — pinned Node/npm, committed lockfile, disposable PostgreSQL, one Ubuntu
   job gating every PR.
3. **Measured behaviour** — the two profilers, their bounds, and their explicit limits (no database,
   capture, worker or HTTP latency; one machine; observational samples).
4. **Accessibility** — method (headless Chromium + axe + computed styles, because jsdom computes no
   colours) and results, including the one recorded 390 px `label-content-name-mismatch` and why it
   was not "fixed".
5. **Scenario validation** — the reference scenario walkthrough, with the honesty caveat per screen.
6. **Threats to validity** — reference-only curriculum, simulated resources, no institutional data,
   no efficacy claim, no user study.

---

## 8. Initiative F — Submission package (by 04/01/2027)

- Format audit against `Thesis_Format_Guideline.docx`: prelim page order (title, signature,
  acknowledgments, TOC, list of tables, list of figures, abstract, text, references, appendix),
  roman/arabic numbering, 1.5"/1" margins, Times 12, double spacing, ≤50 main-text pages.
- Complete the title page and signature page fields (degree, school name, committee names).
- `cd documentation/thesis && make` — three `pdflatex` passes, zero undefined references, page count
  verified from `thesis.pdf`.
- Refresh `appendices/appendix-a-courses.tex` (it claims "all 86 courses") and
  `appendix-b-code-structure.tex` (it lists `CurriculumGraph.tsx`, which is deleted).
- Reading copy: PDF + separate abstract file; three hard copies later per the guideline.

---

## 9. Home stretch (post-submission, no engineering)

11/01–29/01: corrections buffer from the review period. 19/02: council CV. 01/03–07/03: defense
slides, live demo rehearsal, anticipated-question preparation (why no institutional validation,
why simulated resources, why engineering evidence instead of a user study).

---

## 10. Deferred — with the reason each stays out

| Item                                            | Why deferred                                                                                                                 |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| IT/DS curriculum seeding                        | Source conflicts documented (150 vs 16/8/12 credits, `IT097IU`/`IT079IU`, 3 vs 4 credits); guessing substitutes is forbidden |
| Calendar / offering validity                    | No official offering, timetable, room or staff data exists                                                                   |
| Subject category / grade-fit metadata           | Requirement type ≠ subject discipline; needs verified metadata                                                               |
| Assigned-context editing + context-keyed caches | Depends on validated curricula and claim-transfer rules; not a December-sized job                                            |
| Production deployment                           | You chose local Docker; hosting/HTTPS/cookie topology stays a recorded limitation                                            |
| Real-student user study                         | You chose engineering evidence                                                                                               |

---

## 11. Housekeeping (small, do early)

- Commit the untracked `docs/current-data-and-inputs-audit.md` so the audit is not lost.
- Resolve open PR #136 (CS 2025 evidence): verify it still reports `readiness=false` and either
  merge it as read-only evidence or close it. Do not let it linger into the progress check.
- Add a durable repo copy of this plan at `docs/phase-5/thesis-plan-nov2026-jan2027.md` so the
  schedule is not only in this file.
- Update the `AGENTS.md` Active Checkpoint when A1/A2 land.

---

## 12. Inputs I will ask you for, one at a time

1. The title page facts: exact thesis title, degree name, school name.
2. Committee names for the signature page (or "leave blank until assigned").
3. Whether your advisor accepts the current chapter order (Implementation before Results) — the
   guideline's traditional order puts Results before Discussion.
4. Whether `demo.populated@example.test` may be the assigned demo account, or you want a separate
   one (assigning it makes the legacy editable map unavailable for that account).
5. Any written supervisor rubric or evaluation expectation beyond "engineering evidence".
6. Whether the progress check requires a specific form or slide template.

Nothing else is blocking; I will not invent academic rules, host anything, or assign an account
outside the reviewed admin flow.

---

## 13. Sequencing

| Week         | Track 1 (code)                     | Track 2 (thesis)                         |
| ------------ | ---------------------------------- | ---------------------------------------- |
| 7–13 Nov     | A1 server contract + tests         | C1 abstract + conclusion                 |
| 14–20 Nov    | A2 `/admin` panel + tests          | C1 results chapter + figures             |
| 21–27 Nov    | B scenario + walkthrough; rehearse | C2 implementation chapter (start)        |
| 28 Nov–4 Dec | freeze prep; **03/12 check**       | D progress-check package                 |
| 5–11 Dec     | — (fixes only)                     | C2 implementation chapter (finish)       |
| 12–18 Dec    | —                                  | C3 chapters 1–3 + bibliography           |
| 19–25 Dec    | —                                  | E evaluation chapter                     |
| 26 Dec–1 Jan | —                                  | C4 claims ledger + C5 figures            |
| 2–8 Jan      | —                                  | F format audit + **submit reading copy** |

---

## 14. Verification

**Initiative A (server):**

```bash
cd server && npx jest adminCurriculumAssignment.test.ts authCurriculumContext.test.ts
```

Then the full gate:

```bash
npm run build && npm run typecheck && npm run lint
npm test                                   # server (real PostgreSQL) then client
npm run format:check -- "!.impeccable/hook.cache.json"
```

**Initiative A (client):**

```bash
cd client && npx vitest run src/features/admin src/lib/__tests__/adminUsersApi.test.ts
```

**Manual, in a browser against Docker PostgreSQL:**
assign `demo.populated` → `/curriculum` becomes the read-only reference with the progress summary
and saved-course list; `/planner` shows the contextual preview; `/grades` shows the contextual GPA;
`/admin` cohort demand becomes non-empty; then clear the assignment and confirm the legacy editable
map returns and the progress store is writable again. Check 1280 and 390 px, keyboard focus, and
axe on the new panel.

**Thesis:**

```bash
cd documentation/thesis && make        # then check page count and undefined references in thesis.log
```

**Evidence discipline:** a new test must fail against the source it replaces; quote test counts only
after re-running; never weaken an assertion or widen a timeout to make a run pass — record a flake as
an open finding, as the existing checkpoints do.

---

## 15. Risks

- **Assignment changes a demo account's behaviour** (legacy map disappears). Mitigated by the
  compare-and-swap API, a reversible clear, the explicit panel copy, and a two-account demo scenario.
- **Thesis deadline is the real constraint.** If week 1–2 slips into feature work, C1 slips, and C1
  is what stops the document from claiming deleted software. If a trade-off is forced, code stops
  and writing continues.
- **PR #136 is unresolved.** An open evidence PR at the progress check invites questions; resolve it
  early.
- **Engineering-evidence evaluation can read as thin.** Mitigated by organising results by the risk
  each suite protects rather than by file count, and by stating threats to validity plainly.

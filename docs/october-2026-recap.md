# October 2026 recap — what changed in IU Smart Study Planner

**Period covered:** 2 October 2026 → 22 October 2026 (the first and last merge on `main` in that window).
**What landed:** 133 squashed pull requests merged into `main` (`#4` → `#138`), 585 files changed, +120,709 / −3,203 lines.
**What did not land:** the curriculum-assignment gate, the semester calendar validity, the category/grade-fit metadata and the deployment decisions. They are listed in [What is deliberately not done](#what-is-deliberately-not-done-yet) with the reason for each.

This document exists because most of that work is invisible when you use the app. The short
version is in [Where each theme shows up](#where-each-theme-shows-up-in-the-app) — and the single
biggest reason is at the top of that table.

One note on the shape of the month: `main` itself was quiet between 13 June and 2 October, so
October is when a long run of phase work (the curriculum context, the rating engine, the
saved-selection editor, the whole admin simulation stack) actually landed on `main`. The volume
below is not one afternoon of work — it is the accumulated output of the phases that were being
built on branches, landing as 133 small, individually verified increments.

---

## The month in one page

| Theme                                          | What it did                                                                                                                                         | PRs                                        | Visible in the app?                        |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------ |
| Accounts and sessions                          | Cookie auth, demo logins, and an account _scope_ that every read and write now checks                                                               | #7–#16, #61, #69–#78                       | Yes, on every screen                       |
| Curriculum context (major-aware data model)    | A `Curriculum`/`CurriculumCourse`/`CurriculumPlacement` model, a CS backfill, and every progress/grade/rating read rewritten to resolve _per major_ | #45–#52, #59–#78                           | **No** — needs an assigned curriculum      |
| Numeric grades, retakes and GPA                | Immutable retake attempts, credit-weighted GPA from the highest score per course, a Grades screen                                                   | #20–#25, #52, #64–#65, #70, #135           | Yes, on `/grades`                          |
| Course difficulty ratings                      | Students rate completed courses; Bayesian shrinkage with a curriculum prior; ratings feed every estimate                                            | #26–#38, #53, #74–#77                      | Yes, on `/ratings` and as badges           |
| Planner and workload                           | Account-scoped workload analysis, semester planning from the database, context-aware previews                                                       | #33–#36, #44, #54–#56, #60, #63, #120      | Yes, on `/planner`                         |
| Saved plans and the reference-selection editor | Browse own plans → semesters → courses; atomic save with receipts; drafts; blockers; reordering                                                     | #123–#131                                  | Yes, on `/planner`                         |
| Admin simulation stack                         | A whole simulation product: resources, demand, capacity, allocation, semester allocation, queue, execution, capture, history                        | #79–#119                                   | Partly — on `/admin` with an admin account |
| Performance measurement                        | Two reproducible profilers and a documented set of local observations                                                                               | #119, #121                                 | No (tooling)                               |
| Developer experience                           | Reproducible installs, a CI gate on every PR, startup supervision, live shared exports                                                              | #15–#16, #57, #122, #132                   | No (tooling)                               |
| Deployment hardening                           | A production start-up that refuses to start without an explicit frontend origin                                                                     | #134                                       | No (deployment)                            |
| Client correctness and accessibility           | A measured pass over focus, names, contrast and copy, plus an honest-copy fix                                                                       | #120, #133, #137, #138                     | Yes, as you use it                         |
| Source evidence and documentation              | Per-feature notes, a rewritten README, and the open CS 2025 catalog comparison                                                                      | #39, #46, #48–#49, #118, #133, #136 (open) | No (documentation)                         |

---

## Where each theme shows up in the app

**Read this first: why October feels invisible.** The demo accounts (`demo-student@example.test`,
`demo.populated@example.test`, `demo-school-admin@example.test`) all have `curriculumId = null`.
Every curriculum-context feature — the read-only curriculum reference, the contextual progress
summary, the per-major prerequisites, the curriculum rating prior, the scoped planner preview —
only activates for an account that has a curriculum **assigned**. There is still no shipped API or
screen that assigns one (that gate is open, see below), so on the demo accounts the app falls back
to the legacy editable CS map and most of October's server work stays behind that door.

To see it, an account needs `curriculum_id` set in the database. The backfill that populates the
curriculum context exists (`--apply`, see [Curriculum context](#2-curriculum-context-the-major-aware-data-model)),
but the step that _assigns a curriculum to a student_ is the missing piece, and it is deliberately
not automated — the roadmap gate says a catalog must not activate a cohort on its own.

| Theme                      | Screen                  | What you should look at                                                                                                                                                   | What you need                         |
| -------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| Accounts and sessions      | `/login`, `/register`   | Sign in with the demo accounts; the header shows the role and the stored curriculum (`null` for the demo accounts)                                                        | Nothing                               |
| Numeric grades and GPA     | `/grades`               | The GPA card, the retake history, and the new highest-score distribution                                                                                                  | Nothing                               |
| Ratings                    | `/ratings`              | Rate a completed course; the estimate badges appear on the map and in the planner                                                                                         | Nothing                               |
| Planner                    | `/planner`              | Workload estimate of the saved planned courses, the read-only suggested list, the saved-plan browser (Plan → View semesters → View courses → Edit saved course selection) | Nothing                               |
| Saved-selection editor     | `/planner`              | _Edit saved course selection_ → set a year/semester → _Check proposed courses_ → _Save course selection_                                                                  | Nothing                               |
| Curriculum context         | `/curriculum`           | **Only visible with an assigned curriculum.** With `curriculum_id = null` the route shows the legacy editable map instead of the read-only reference                      | An account with a curriculum assigned |
| Admin simulation stack     | `/admin` (School admin) | The resource form, the cohort/planned-selection report, the capacity diagnostic, the allocation preview, the semester preview, and the request history panels             | The demo school-admin account         |
| Client accessibility fixes | everywhere              | Tab through the map, the planner and the admin: focus now survives a slow read, names say what a control does, and the "NEXT" badge is readable                           | Nothing                               |

---

## 1. Accounts, sign-in, and the account scope

This is the foundation everything else in October stands on.

**Cookie authentication replaces the bearer token** (#7, #8). The token lives in an httpOnly
cookie, `SameSite=Lax`, secure in production; the client never reads it. Register, login, session
restore and development demo logins (#9) all became cookie flows. Legacy localStorage token
cleanup happens at start-up.

**Every read and write learned to check _whose_ account and _which_ curriculum it is for.** This
was the month's biggest theme and it is almost invisible in the UI because it is a refusal
mechanism rather than a feature:

- Grade writes, rating writes, progress writes and saved-semester writes accept a strict
  optional `expectedScope` (owner + curriculum UUID or null) and compare it **inside the existing
  Serializable transaction** before anything else happens (#69–#78). A stale scope is a `409`, not
  a silent write against the wrong account.
- Progress gets a dedicated scoped snapshot endpoint (`GET /api/users/me/progress/snapshot`) that
  returns the cookie owner, the stored curriculum and the active selections from one repeatable
  read (#72).
- Rating and grade _reads_ were scoped the same way: a rating summary returns the account's own
  votes with the current context (#75), completed-course rating choices come from one snapshot
  that includes member-aware priors (#76), and the Ratings screen persists the confirmed account
  context in every request it sends (#77).
- Saved-semester writes validate placed membership in the **plan owner's** curriculum and compute
  totals with that curriculum's rating prior (#56, #78).
- Uppercase UUID route parameters were being rejected before normalisation could run (#62).

**The session-expiry race** (the last thing merged, #137) deserves its own paragraph because it
took seven independent review rounds. A protected read refused with 401 ended the session even when
the user had already signed in again while that read was in flight. The fix records the session
generation each request was sent under; a refusal from an earlier generation is ignored, a refusal
from the current generation still ends the session. The review rounds found seven further defects
in the fix itself, including one where a _failed_ sign-in could hide a genuine expiry, and one
where a superseded sign-in that still reached the server was treated as if nothing happened.

**Demo accounts.** `demo-student@example.test` (shared, empty) and
`demo.populated@example.test` (17 completed courses, 51 of 130 credits, GPA 72.36 on the Thesis
path, five planned courses, one saved plan) exist so the signed-in screens can be exercised
without writing academic records by hand.

---

## 2. Curriculum context: the major-aware data model

Before October, the app had one global catalogue and one global prerequisite graph. "Computer
Science" was a label, not a data model, so the same shared course (e.g. `MA001IU` Calculus) behaved
differently depending on which major you imagined yourself in. October added the missing model.

**The foundation** (#45): additive `Curriculum`, `CurriculumCourse`, `CurriculumPlacement` and
`CurriculumPrerequisite` tables, with `Course` staying global and placement becoming
_per curriculum_. Prerequisites became curriculum-scoped edges. Migration
`20261003104000_add_curriculum_foundation`.

**The catalogue could not simply be copied** — the legacy CS source repeats courses across
elective groups and contains a blank-code requirement. So there is a read-only verifier that
proves the source can be loaded without losing meaning (#46), storage for uncoded requirements
(#47), a compatibility preflight before any write (#48), and an atomic `--apply` backfill that
preserves repeated elective occurrences, source order, the free-elective requirement and legacy
prerequisite provenance (#49).

**Everything then learned to read through the context.** A reference-only snapshot endpoint
exposes placements and prerequisite edges for one curriculum with no legacy fallback (#50). An
assigned account must not complete or import courses using another curriculum's rules (#51).
Numeric GPA and coverage are scoped to curriculum membership while the full attempt history stays
(#52). Rating replies use the curriculum's prior rather than the global one (#53). Workload
analysis resolves the account's curriculum, its placements and its prior in one snapshot and
rejects a nonmember selection atomically (#54). Recommendations do the same (#55). Profile and
record reads separate current member data from preserved history (#59). The grade entry offers only
placed courses in the account's curriculum (#65). The planner shows a context-aware read-only
preview instead of the global heuristic (#63). The progress summary and the saved-course list
stop reporting a catalogue-derived "degree percentage" that no verified rule can support (#58,
#67, #68). The legacy map is mounted only for a confirmed null context; an assigned account gets a
read-only reference view (#66).

**Why you cannot see any of this yet:** see [Where each theme shows up](#where-each-theme-shows-up-in-the-app).
The assignment gate is open, and the roadmap decision is that a catalogue must not activate a
cohort on its own.

---

## 3. Numeric grades, retakes and GPA

**Grades became numeric and immutable.** Each attempt is an immutable row with an account-scoped
retry key, so a retake is a new attempt rather than an overwrite (#22). The GPA is the
credit-weighted average of the **highest** score per course, with physical training excluded
(#21) — the policy the roadmap had been assuming. Earned credits were aligned across the profile
and the progress summary so the two screens stopped disagreeing (#20).

**The Grades screen** (#23, #24) lists the attempt history and the GPA, and the entry form records
a new attempt with safe retry recovery (#25). The legacy letter-grade path was guarded to the
response scope so a summary from another owner or curriculum cannot leak into it (#69).

**The newest piece, and the one you can see** (#135): a highest-score distribution on `/grades`.
Each course counts once, at its highest recorded score, in five numeric ranges with the exact
counts in an accessible table — no colour or bar width carries meaning. The policy text is
explicit: "Only courses with recorded numeric scores are included. Ungraded courses are not
counted as zero."

---

## 4. Course difficulty ratings

Students can now rate a completed course 1–5 (#32), the votes are stored with an atomic cached
average and count (#27), and the difficulty shown everywhere is a **Bayesian shrinkage** of that
average toward the curriculum's prior, with the vote count always visible next to it so a reader
can judge the confidence (#26, #29, #30). Rating writes are completion-gated and account-scoped
(#28, #74–#77), with a durable hourly write limit per account (#30 migration).

The estimates then feed the places that previously used a seed value: the curriculum map badges
(#38), the semester totals (#37), the workload recommendations (#33) and the semester ranking
(#35). The server GPA path now filters recommendations before ranking and credit budgeting
(#41, #43).

---

## 5. Planner, workload and semester planning

Prerequisites for semester planning came from the database instead of a duplicated array in the
client (#34). The planner ranks courses with the Bayesian difficulty estimate and reports
incomplete schedules honestly rather than implying a feasible semester (#35, #36). The saved-course
planner dashboard was activated (#44), and the workload analysis and recommendations became
account- and curriculum-scoped (#54, #55). The saved-semester write path validates placed
membership, computes authoritative totals and shares one Serializable transaction with the
authorization and the course evidence (#56).

**The compact map UI** (#120) is the client work of the month: the semester-node view with the
colour legend, keyboard equivalents for the right-click planning action, ratings that keep their
score and vote count, two-directional scrolling, sticky semester headings, a view reset that keeps
selections, and an accessible map control set.

---

## 6. Saved plans, saved semesters and the reference-selection editor

This is the most recent functional theme and it is fully visible in the app on `/planner`.

The **own saved plans browser** (#123) shows the account's plan metadata five at a time with
latest/older navigation. **Saved plan semester references** (#124) and **saved semester course
references** (#125) drill down one level each, reading the account, the owned plan, the guarded
stored JSON and the current catalogue in one repeatable snapshot. Each saved course then shows
whether it is **placed in the account's current curriculum** (#126) — "Listed in your current
curriculum", "No placement in your current curriculum", "No curriculum assigned — membership not
assessed" are kept distinct.

**The reference review** (#127) checks a saved semester against an explicitly chosen academic
year and semester and reports placement mismatches, GPA exclusions and unmet mandatory
prerequisites, bound to one snapshot. It is explicitly read-only.

**The atomic save** (#128) is the substantial one: the owner can add and remove current placed
courses and save a reference selection for a chosen year/semester. The server checks ownership,
curriculum, revision, mandatory current-completion prerequisites and the exact numeric GPA in one
Serializable transaction; revision comparison, canonical selection, historical reference metadata
and an immutable account/request receipt commit together; exact retries recover a lost
acknowledgement and a changed input conflicts. **Unsent drafts** are recoverable per tab with
explicit Restore/Discard (#129). **Proposed-course blockers** are explained per course before
saving (#130). **Display order** can be changed with Move up/down, and the UI states that order
does not change academic chronology, prerequisites or allocation priority (#131).

---

## 7. The admin simulation stack

This is the largest block of October and the least visible, because it lives behind `/admin` and
because the thesis decision keeps it explicitly _simulated_.

**Resources** (#79, #80): an additive `SchoolResource` model with curriculum/semester scope,
per-course overrides, revision preconditions so a concurrent save cannot overwrite yours, and a
tab journal that preserves the request before it is sent.

**Demand and capacity** (#81–#87): scoped planned selections for the assigned cohort; an explicit
capacity diagnostic where zero seats stays distinct from unknown seats and a classroom proxy is
never copied into every course; the planned-selection report; the eligible cohort demand; the
shared classroom/staff resource envelope; and a combined cohort-and-resource snapshot so the two
reads cannot observe different database revisions.

**Allocation** (#88–#92): a pure scarcity round — students with the fewest capacity-feasible
choices get priority, sections consume the shared envelope, UUID ties are deterministic — then the
aggregate preview, the unlock utility (a child counts only when completing a candidate satisfies
its sole remaining prerequisite), the immutable capture, and the paged history.

**The one-course job queue and worker** (#93–#99): durable admin requests with actor
preconditions and retry keys, an explicit `--apply <job-uuid>` worker that never drains a queue
and never starts a daemon, protected execution through the API, and the request-history read.

**The full-semester simulation** (#102–#119) is the newest and largest piece:

- a separate pure credit-budget model that allocates several courses per student across
  scarcity-ordered rounds against one shared section/seat ledger (#102);
- private per-student outcomes stored immutably with exact actor/scenario retry recovery (#103);
- a coherent multi-course preview (#104), protected capture with outcomes (#105), the admin
  dashboard preview (#106), safe capture controls with tab recovery (#107);
- the student's own semester-simulation history: discovery (#108), validated private readers
  (#109), a student panel in Planner (#110);
- a durable semester queue with per-admin retry keys (#111), an atomic one-job executor (#112),
  protected execution through the API (#113), browser-side durable recovery journals (#114) and
  the admin request controls (#115);
- the admin request history read and browser (#116, #117), and the merged history checkpoint
  (#118).

**Profiling** (#119, #121) then measured this machinery: a production-output profiler over six
fixed synthetic workloads (up to 500 students / 10,000 choices / 100 rounds / a 10,000-course
catalogue) and a profiler over the actual persisted verifier and projection paths. The reports
are explicit that they exclude database, capture, worker and HTTP latency, and they record the
local observations (maximum-case allocation medians 3.38–4.84s on an Apple M2) without claiming
latency or memory guarantees.

---

## 8. Performance, developer experience, CI and deployment

- **Reproducible installs** (#132): the root lockfile is committed, Node 24.22.0 / npm 11.19.1 are
  pinned, `npm ci` is used locally and in both Dockerfiles, and a read-only Ubuntu workflow now
  verifies every PR and every `main` push — runtime versions, build of shared and both apps,
  types, zero-warning lint, formatting, then migrations and seed against a **disposable**
  PostgreSQL service before the startup, server and client suites. No deployment secret and no
  access to the application database.
- **Startup supervision** (#122): the development launcher builds shared output first, then runs
  the watchers with Node built-ins instead of the missing `concurrently` package, stops the sibling
  process trees on failure, and Docker applies reviewed migrations with `migrate deploy` instead
  of the interactive `migrate dev`. No reset, seed, volume deletion or container recreation.
- **Live shared exports in development** (#57): the backend watches the emitted shared output and
  Vite forces a debounced dependency re-optimisation, so a shared-schema edit reaches the browser
  without a manual restart.
- **Production start-up hardening** (#134): production now requires one explicit HTTP(S)
  `CORS_ORIGIN` before it imports the database or opens the listener. The value is canonicalised
  (case, root slash, default ports) and blanks, wildcards, origin lists, credentials, non-root
  paths, queries, fragments, controls, whitespace and backslashes are rejected with a generic
  error that never echoes the value. Development and test behaviour are unchanged, and no hosting
  or domain policy is imposed.

---

## 9. Client correctness and accessibility (#120, #137, #138)

The most recent two PRs are a measured pass over the client, and they are the ones you can judge
by using the app.

**#137** (client correctness and accessibility, 76 commits on its branch, squashed into one commit on `main`) fixed, among others: a curriculum map
that faded the whole map when a locked course was hovered; an elective panel that was 40+ tab
stops away from the card that opened it and ignored Escape; a save that stole the keyboard
user's place because Chromium drops focus to `<body>` when the focused control becomes disabled;
zoom buttons that looked available at their limits; a crash screen with no exit; a sign-in error
that left focus at the top of the document; a rejected score that did not point at the field that
needed fixing; a curriculum load that could not be retried in place; and a session-expiry race
(described above).

**#138** (the follow-up, 7 fixes): the course-load options now say in their accessible name what
load they suggest; the zoom and reset controls describe themselves in text a screen reader reads
instead of only in a tooltip; the selected-course list separates the course code from its name
instead of running them together; and the focus now lands somewhere real after adding a course
override, removing one, removing a saved course, and clearing the pending rating retry.

---

## The data model after October

23 models and 6 enums. The October migrations added: cookie auth and the elective claim
(`20261002…`), grade attempts (`20261003…`), course ratings with the cache lock and the write
limit (`20261003…`), the curriculum foundation and requirements (`20261003…`), the simulation
resources (`20261004…`), the allocation runs/jobs/executions and their link table (`20261005…`),
the semester simulation storage/jobs/executions (`20261006…`, `20261007…`) and the reference
selection receipts (`20261016…`). All of them are additive; nothing was dropped or rewritten in
place.

---

## Decisions taken (and locked)

These are recorded in `AGENTS.md` and are not to be relitigated without new evidence.

- **`Course` is global; placement is per curriculum.** Shared courses (`MA001IU`) must not be
  duplicated per major, and the year/semester of a course differs by major, so placement cannot
  live on `Course`.
- **The server is authoritative for completion and cascades.** A client must not be able to
  complete a course whose prerequisites are unmet.
- **Every database prerequisite is mandatory.** The duplicated "rules" array that lived in the
  client was removed; recommended/corequisite flags no longer soften anything.
- **Prerequisites resolve inside the account's curriculum**, never as a union across majors.
- **The simulation models are frozen.** The one-course allocation and the semester credit-budget
  model are versioned contracts with a pinned replay; changes are new versions, not edits.
- **A refusal is dropped rather than acted on.** The session-generation model deliberately ignores
  a 401 that belongs to an earlier session instead of ending the session in use.
- **No curriculum is activated from a catalogue artefact.** The CS 2025 comparison (#136, still
  open) reports evidence only: `readiness=false`, `signatureVerified=false` and four blocker
  categories are always retained.
- **Feature increments are small, reviewed, and merged as one squashed commit** with a verification
  body, which is why `main` reads as 133 tidy commits rather than a few large ones.

---

## How every change was verified

The evidence standard used throughout October, so you can judge any individual PR:

- **Real PostgreSQL, not mocks.** The server suites run against a disposable database seeded per
  run; the current count is 2,972 server tests across 107 suites, 2,476 client tests across 108
  files, and 10 startup lifecycle cases.
- **One Ubuntu job gates every PR and every `main` push** (#132): build, types, zero-warning lint,
  formatting, migrations and seed against a disposable service, then the startup, server and
  client suites.
- **A new test must fail against the source it replaces.** The fail-first proof is captured in the
  commit message — for example the session-expiry work has 17 integration and 5 unit tests, each
  shown failing without its fix.
- **Client work was measured in a real browser** (headless Chromium, axe-core, computed styles),
  because jsdom computes no colours and does not move focus the way a browser does. That is how the
  map hover fade, the invisible focus ring, the label-in-name failures and the focus losses were
  found.
- **Independent review rounds.** The session-expiry fix went through seven rounds of independent
  review (the GPT provider was unavailable, so DeepSeek was used through two different providers);
  each round's findings were fixed and re-tested before the next.
- **Nothing was weakened to pass.** Where a run flaked, the cause was recorded as an open finding
  rather than papered over — for example one unchanged authorisation test that answered 401 once
  instead of 403 is still noted in `AGENTS.md` with its cause unestablished.

---

## What is deliberately not done yet

| Gate                                   | Why it is still open                                                                                                                    | What exists already                                                      |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Assigning a curriculum to an account   | The catalogue must not activate a cohort on its own; the policy decision is recorded, not decided                                       | The context model, the backfill, and every context-scoped read (#45–#78) |
| Verifying the signed CS 2025 catalogue | The PDF bytes, hash and page locators are recorded, but names, prerequisite graphs, substitutions and graduation rules are not verified | #136 — a read-only evidence snapshot and offline inspection command      |
| IT and DS curricula                    | CS is the reference; the other majors wait for their reviewed sources                                                                   | The model is major-agnostic                                              |
| Calendar validity                      | No official offering or timetable data is available                                                                                     | The explicit reference year/semester the editor saves (#128)             |
| Category and grade-fit metadata        | Requires verified subject metadata                                                                                                      | Difficulty, prerequisites and credits are used                           |
| Deployment                             | No hosting, HTTPS or proxy topology has been chosen                                                                                     | The production origin preflight (#134) and the CI gate (#132)            |
| The thesis chapters                    | They follow the verified implementation                                                                                                 | This document and the per-feature notes under `docs/`                    |

Two smaller items are recorded as known limitations rather than fixed:

- **The archived-import dead end** for an account whose archived course is no longer in the
  catalogue: the import is blocked and the copy says so, because changing what gets submitted is a
  server-contract decision.
- **The 390-only `label-content-name-mismatch`** that axe reports on the curriculum cards: the
  card reaches past the edge of the horizontally scrollable map, so axe drops the credits from the
  visible text and compares the remainder with the accessible name. The name does contain every
  visible word, and the page is clean at 1280, so no name was changed for it.

---

## Where the detail lives

- `docs/phase-1/ … docs/phase-4/` — one note per feature, with the contract, the limits and the
  next gate (94 files in total).
- `AGENTS.md` — the living checkpoint: the phase tables, the locked decisions, the schema, the
  roadmap gates and the "Active Checkpoint" history with the dates.
- `PRODUCT.md` — the product definition used by the design tooling.
- `README.md` — the current, honest setup and feature guide (rewritten in #133).
- The pull request bodies themselves. Each one records what changed, what was deliberately left
  out, the exact test counts and the CI run. `gh pr view <n>` is the fastest way to read the
  reasoning behind any single change.
- `docs/phase-5/continuous-integration.md` and `docs/development-startup.md` — the runtime and
  verification contracts.

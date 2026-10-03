# AGENTS.md - Development Guidelines

## Quick Start

```bash
npm run install:all                         # Install all workspace deps
# First setup: copy server/client .env.example to .env without overwriting existing files
docker compose up -d postgres               # Start only Postgres for local Node development
npm run db:generate --workspace=server      # Generate Prisma client
npm run db:migrate --workspace=server       # Apply development migrations
npm run db:seed --workspace=server          # Populate an empty database
npm run dev                                # Build shared, then run shared/client/server together
```

## Essential Commands

### Root (workspace)

- `npm run dev` - Build shared first; start shared/client/server watchers together (5173/3001); Ctrl-C stops all watchers
- `npm run dev:backend` / `npm run dev:frontend` - Build shared first, then watch shared plus one application (Docker development uses these paired watchers)
- `npm run build` - Build shared, then client + server for production
- `npm run lint` - Lint all packages (zero warnings allowed)
- `npm run typecheck` - Type-check all packages (tsc --noEmit)
- `npm run test` - Run all tests (server Jest first, then client Vitest)
- `npm run format` - Format all files with Prettier

### Server (server/)

- `npm run db:migrate` - Run Prisma migrations
- `npm run db:generate` - Generate Prisma client (run after schema changes)
- `npm run db:seed` - Seed database with sample data
- `npm run db:studio` - Open Prisma Studio UI

### Shared (shared/)

- `npm run build` - Compile Zod schemas/DTOs (run after any change to shared/)

## Database Setup Sequence

1. Start PostgreSQL (`docker compose up -d postgres` for local Node development)
2. In `server/`: `npx prisma generate`
3. In `server/`: `npx prisma migrate dev` (or `npx prisma migrate reset` for clean slate)
4. In `server/`: `npx prisma db seed`
5. Start dev servers

**Never commit `.env` files** — they are gitignored.

## Architecture

- **Monorepo** with workspaces: `client/`, `server/`, `shared/`
- **Routing**: `react-router-dom` — `/` demo, `/login`, `/register`, protected `/curriculum`, `/grades`, `/ratings` and `/planner`. The Grades dashboard shows numeric GPA and retake history; numeric grade entry is available; the admin dashboard remains pending.
- **State**: Zustand store (`client/src/lib/store.ts`), server-backed for signed-in accounts with localStorage as a confirmed-state cache; anonymous demo stays browser-local
  - `completedIds`: `Record<string, string | null>` — maps courseId → electiveGroup name (or null for non-elective)
  - `plannedIds`: `string[]`
  - `progressStatus` gates editing until server hydration succeeds; one mutation is pending at a time
  - Server responses reconcile the full snapshot; failures roll back and reload before another edit
  - Old account-local selections are archived under `browser_progress_backup:<userId>` before first server hydration; guest selections are never imported
- **API**: Express backend with Zod validation, returns `{ success, data?, error? }`
- **Auth**: JWT in an httpOnly cookie — NOT localStorage. `cookie-parser` on the server, `credentials: 'include'` on the client
- **Shared types**: All Zod schemas and TypeScript DTOs in `shared/src/` — changes require `npm run build` in `shared/` before client/server can use them
- **Prisma**: Singleton in `server/src/db.ts` uses `global` to prevent multiple instances during hot reload
- **Curriculum view**: custom semester-column CSS layout. React Flow + dagre were **removed** (dead code, see Roadmap Decision D2)

## Key Conventions

### Completed Credits

- `PT001IU` (Physical Training 1) and `PT002IU` (Physical Training 2) are required but **do not count** toward completed credits
- They **do count** toward planned credits and semester planning

### Elective Groups

- Courses can appear in multiple elective groups (e.g., IT160IU in both Group 2 and Group 3)
- A completed course is **claimed** by the group where it was clicked (stored in `completedRecord[courseId]`)
- Completed courses are **hidden** from other groups where they appear as duplicates

### GPA Paths (Year 4 Semester 2)

- GPA > 70: shows only Thesis (IT058IU), hides other Y4S2 courses — target = 41 remaining courses
- GPA <= 70: shows all Y4S2 courses except Thesis — target = 43 remaining courses
- Signed-in numeric GPA uses the server grade-summary path; the displayed rounded GPA never determines eligibility. Manual controls remain under Y4S2 only for guests or a confirmed null GPA. Loading/error blocks course edits and shows retry; focus/visibility refresh updates the path after grade edits.

### Degree Progress

- Calculated as `completedIdKeys.length / target * 100` (not from API)
- Target is 41 or 43 depending on GPA mode
- Remaining courses = target minus completed count

### Prerequisite Cascade Uncomplete

- Uncompleting a course must cascade: automatically uncomplete ALL completed courses that depend on it (directly or transitively)
- **Anonymous demo**: client BFS over a reverse dependency map (`prerequisiteId -> dependentCourseIds[]`) built with `useMemo`
- **Signed-in accounts**: SERVER authoritative via `POST /api/users/me/complete`. Every prerequisite is mandatory, including recommended/corequisite rows. Mutation, transitive cascade, and returned full progress snapshot occur in one serializable transaction; client BFS is optimistic pre-computation only
- Applies to both click uncomplete and right-click "complete to planned"

### Sidebar/Graph Scale Guard

- The graph should ONLY rescale when the sidebar transitions between open and closed (`null` ↔ group name)
- Switching between elective groups while the sidebar is already open must NOT trigger a scale recalculation
- Use a `useRef(false)` for `wasSidebarOpen` to distinguish open/close transitions from intra-sidebar group switches

### Type Safety

- **Strict mode** — no `any` types
- **Never** use `eslint-disable-next-line react-hooks/exhaustive-deps`
- Always use `useCallback` for functions referenced in `useEffect` dependencies

### Import Order

1. External packages
2. Shared workspace (`@iu-study-planner/shared`)
3. Absolute internal (`@/lib/store`, `@/components`, etc.)
4. Relative imports
5. Styles last (client only)

## Testing

- Client: Vitest with jsdom. Run single file: `cd client && npx vitest run path/to/test.tsx`
- Server: Jest with ts-jest against **real PostgreSQL** (docker must be running). Suites run sequentially to prevent shared-database predicate-lock contention; explicit race tests still run concurrent requests. Run single file: `cd server && npx jest filename.test.ts`
- Root `npm run test` runs server first, then client

## Common Issues

- **Docker compose errors**: Container name conflicts — run `docker stop isp-postgres && docker rm isp-postgres` first
- **Stuck on "Loading curriculum"**: Usually means the `fetchCurriculum` useEffect was accidentally deleted or the server isn't running
- **ElectiveSelector**: **deleted** in Thesis Phase 2 — it imported a non-existent `Checkbox` and duplicated the sidebar UX. Do not reintroduce it
- **Prisma P2025 errors**: Use `isNotFoundError()` helper to handle "record not found"
- **Shared types not updating**: After changing `shared/src/`, run `npm run build` in `shared/` — client/server import from compiled `dist/`
- **Production migration**: `docker-compose.yml` runs `prisma migrate dev` (dev-only). Deployments must use `prisma migrate deploy`

## Git Workflow

- Conventional commits: `feat:`, `fix:`, `style:`, `refactor:`, `test:`, `chore:`
- Do not commit/push unless explicitly instructed
- Push to `main` when asked

---

# Thesis Roadmap (2026)

Full execution prompt: `documentation/thesis/MASTER_IMPLEMENTATION_PROMPT.md`. This section is the
decision record + working conventions. Read both before starting roadmap work.

## Implementation Progress — 2026-10-03

User-approved working scope: features first, keep each change small, simulated students,
deadline end of 2026, all prerequisites mandatory, new grade entry uses actual 0–100 scores, credit-weighted GPA uses the highest course score on
retakes. Preserve legacy letter grades without inferred numeric conversions. CS is the current reference; IT and DS are next. Other schools are deferred.
Branches, pushes, and PR creation/merge are authorized in this conversation.

| Area                           | Shipped / verified                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Remaining                                                                                                       |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Client foundation              | Dead graph/elective selector removed; build/type/lint clean; prerequisite locking and cycle-safe optimistic cascades; Y4S2 recommendations respect both GPA paths before counting credits; same-slot client recommendations use Bayesian difficulty, count duplicate elective placements once and retain unknown legacy estimates without seed fallback; server recommendation ranking uses configurable credit-weighted highest numeric scores by requirement category and difficulty band                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Curriculum context, timetable/capacity planning                                                                 |
| Auth and demo roles            | Cookie register/login/logout/me; ownership/admin guards; session recovery even when browser storage is denied; development-only demo student/admin buttons; header role; explicit stored curriculum identity in register/login/me/demo replies with fresh database session reads                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | School-admin dashboard and production deployment                                                                |
| Student progress               | Authenticated `/users/me/progress` and `/users/me/complete`; elective claim column; mandatory prerequisite validation; transaction cascade; browser hydration, optimistic saves, reconciliation, rollback/recovery, account isolation, cache backups; owner/admin guards for legacy student, study-plan and personalized recommendation reads; additive archived-selection import API with atomic prerequisite/cycle validation; validated account-scoped browser import action, confirmed-state reconciliation and backup-preserving recovery; inline archived course/claim review, explicit import/Later controls and prerequisite/context blockers; profile/progress completed credits consistently exclude physical training; assigned-context membership/claim checks, mandatory completion/import/cascade rules and filtered active snapshots preserving nonmember history; contextual progress-summary reads with shared GPA/prerequisite availability and explicit unknown degree percentage; contextual profile/record views with member numeric GPA, preserved history and honest cached-plan scope                                                                                                                                                                                                                                       | Assignment/switch validation and client context hydration                                                       |
| Study plans                    | Legacy semester create/update rejects duplicate and unknown course IDs atomically before saving; UUID normalization, strict fields and authoritative credits and snapshot-consistent Bayesian difficulty totals on course-list saves; owner-context placed-membership validation and priors with serializable authorization/total/save snapshots, bounded retries and explicit slot conflicts; cookie-account selected-course reference previews with own placements, mandatory earlier-slot prerequisites, GPA filtering, priors and explicit unscheduled reasons; protected session-gated client preview with runtime validation, intensity, retry and stale response isolation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Validated semester planning and curriculum context                                                              |
| CS/IT/DS source gate           | User-supplied official CSE page reviewed; signed 2024/2025 curriculum links identified; existing CS JSON retained as attribute/layout reference; additive context membership/placement/prerequisite foundation and nullable user assignment; strict read-only CS verifier with portable source manifest preserving 71 placements/56 identities and explicit free-elective requirement and additive requirement storage; read-only catalog compatibility inspection and atomic/idempotent legacy CS context backfill; reference-only context list/detail API and isolated curriculum Bayesian priors                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Contextual recommendations/workload/planner readers; reconcile signed PDFs, validate IT/DS, then major selector |
| Grades and GPA                 | Existing grade metadata preserved by completion updates; tested numeric 0–100 GPA calculator, highest score per course, credit weighting and physical-training exclusion; additive immutable numeric GradeAttempt history with account-scoped retry keys; authenticated numeric grade history/append APIs with consistent summaries and explicit coverage gaps; protected Grades dashboard with retake history, loading/retry states and account isolation; numeric grade entry with account-scoped tab recovery, immutable retry keys and full-snapshot reconciliation; server GPA path in grade summaries with decimal-exact >70 policy; signed-in curriculum path/target/recommendations follow the server with account isolation, refresh, retry and explicit-null manual fallback; member-scoped numeric GPA/coverage with full immutable history, placed-membership entry checks, safe old-key recovery and nonfork null path                                                                                                                                                                                                                                                                                                                                                                                                                 | Client context/scope/nonfork handling and verified subject metadata                                             |
| Ratings and recommendations    | Seed difficulty prior retained; pure Bayesian shrinkage helper with prior strength 5, zero-rating mean behavior and confidence count; additive global CourseRating rows with unique account/course votes, 1–5 checks and atomic cached averages/counts, including concurrent writes and FK deletion; public consistent rating summaries with global prior resolution and Bayesian estimates; explicit validated curriculum reads and cookie-owner member vote replies share curriculum priors while preserving historical global votes; completion-gated cookie-authenticated upserts and durable configurable hourly quota, idempotent unchanged retries; private current-account vote reads; batched, snapshot-consistent difficulty/count projections in course lists, detail and curriculum rows; visible difficulty/count badges with honest zero-vote copy; protected Ratings route with completed-course 1–5 entry, saved personal votes, account isolation, session-tab recovery and locked same-vote retries; Bayesian estimates consumed by workload averages, risk, validation, personalized course selection and configurable semester ranking and explicit unscheduled-course reporting without misleading graduation estimates; duplicated planner `RULES` removed, all database prerequisite flags enforced across earlier semesters | Context-scoped semester recommendations, client adoption and multi-objective scoring                            |
| School admin                   | Real ADMIN role and demo session                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Resources, demand, scarcity allocation, multi-objective scoring, dashboard — required                           |
| Verification/deployment/thesis | Real PostgreSQL and client regression suites; shared-first root builds/typechecks/tests; concurrent local startup; Docker shared builds with isolated compiled output; local Docker smoke checks                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Deployment gate and thesis chapters                                                                             |

Full phases are **not** marked complete: curriculum context, grades,
ratings, and resource allocation are still outstanding. The user explicitly prioritized
feature increments before extending curriculum coverage.

Source notes: `docs/phase-1/cse-curriculum-sources.md`. Signed 2025 documents differ
from page HTML in credits, course codes, and elective rules. IT has Network Engineering
and Computer Engineering tracks. Some shared courses have different prerequisites
across majors; retain global Course identities but resolve prerequisites in curriculum
context before seeding IT/DS. Do not union prerequisite sets across majors.

Current verification: 721 server tests and 463 client tests (integration suites use real PostgreSQL), covering cookie/role access,
mandatory prerequisites, transactional cascades, optimistic store saves, failure recovery,
stale account responses, legacy cache backups, guest isolation, and legacy read ownership/role guards, additive import validation/concurrency, denied-storage session recovery, and GPA recommendation budgets. Re-run quality gates
before each commit; keep these counts current when tests change.

Local startup verification: root build and dev work without existing `shared/dist`;
frontend/backend respond on separate test ports; one Ctrl-C stops all three watchers
without leaving processes or listening ports. Docker images build from clean source,
and backend curriculum reads work with the source bind mount and isolated shared output.
Shared runtime edits now trigger backend reload and forced browser dependency re-optimization;
two successive edits and clean interrupt shutdown passed in isolated root and split-app modes.
Fresh Docker image defaults and two automatic runtime edits also passed in disposable containers.

Remaining stabilization findings: partially populated database seed behavior,
and the sidebar overlay/pan bounds in uncommitted interface work. Those interface
edits are preserved separately from the narrow auth/GPA fixes.

## Active Checkpoint — 2026-10-03

Development remains active; work needing unavailable input is skipped and recorded. Increments
through PR #67 are pushed/merged. The narrow current saved-course list is verified and ready for its own PR. Saved-semester creation/course-list edits
follow the plan owner's stored curriculum, including admin writes. Placed membership, rating
prior, current actor role, owner/nested-resource authorization, authoritative totals and save
share one Serializable transaction with bounded retries. Nonmember/unplaced selections reject
with 409; missing courses retain 400 validation details; same-slot conflicts return 409. Strict
UUID/duplicate/order behavior is retained. Explicit empty lists save zero totals. Metadata-only
edits preserve historical cached lists/totals after rating or context changes; explicit list
saves must satisfy current membership. Reads remain cached, with no silent history rewrite.

Fourteen new PostgreSQL cases plus existing semester/rating/access regressions pass 60 focused
cases. Build, typecheck, zero-warning lint and 624 server / 310 client tests pass for the isolated
snapshot. Final review remains inline after the prior agent thread limit. No account assignment,
selector, seed or data reset was used. Unrelated staged/interface changes remain preserved. The
prior single nonreproducing workload HTTP failure remains recorded as a stability finding.

This checkpoint fixes stale generated shared output during development. Root/split-app commands
run a shared compiler; the backend watches emitted output and Vite re-optimizes linked CommonJS
exports with debounced cleanup. Docker Compose/Dockerfile development commands adopt split-app
watchers. Two successive shared runtime edits reached backend and browser automatically in both
isolated modes; interrupt closed test listeners. Compose validation passed. The user's running
5173/3001 app was not stopped/recreated; Docker command changes require application recreation; cached dependency volumes lacking concurrently
need the documented build/renew command. The named PostgreSQL volume is retained.
Fresh image defaults and two automatic shared runtime edits passed in disposable Docker containers
that were then removed. Build/types/lint and 624 server / 310 client tests pass for this isolated snapshot. No schema/data
change was made. See docs/phase-1/shared-development-reload.md for the verified scope.

The progress-summary read now shares recommendation availability in one repeatable-read
snapshot. Assigned accounts receive contextual placements/priors, member-only earned credits,
and separate nonmember history preserving legacy grades/claims. Empty contexts never fall
back to global courses. Reference totals do not produce a degree percentage; that remains
null until verified elective/degree rules exist. Unassigned response compatibility is retained.
Twelve PostgreSQL regressions plus recommendation/access coverage pass 63 focused cases.
Build/types/zero-warning lint and 636 server / 310 client tests pass for the exact isolated
snapshot. An independent subagent review found no blocking issue; its two requested test assertions
for eligible planned courses and archived elective claims were added. No assignment/data reset.
See docs/phase-2/curriculum-progress-summary.md for the API and remaining client gate.

Profile and raw-record reads now use the owner context in one repeatable-read snapshot.
Current-member metadata and separate basic historical projections preserve all statuses,
claims and legacy grades. Assigned profile GPA is the existing highest-score numeric policy,
never a guessed letter conversion; PT is excluded from earned credits. Cached plans remain
unchanged and explicitly unvalidated in the context. Unassigned profile/array compatibility,
UUID precedence and owner/admin guards are retained. Twelve new PostgreSQL cases pass with
access/progress coverage (41 focused cases). Independent review found no blocking issue.
Build/types/zero-warning lint and 648 server / 310 client tests pass for the exact isolated
snapshot. See docs/phase-2/curriculum-account-views.md. No assignment/selector/data reset.

Assigned semester previews now use cookie-account stored PLANNED selections, completions,
numeric GPA and context metadata in one snapshot. Own reference placements and mandatory
parents in earlier slots constrain scheduling; no global JSON/calendar/category fallback,
body completion override or auto prerequisite expansion is used. Duplicates count once,
PT counts toward planned credits, and unscheduled choices have explicit reasons. Bayesian
ranking excludes impossible downstream bonuses; cycle diagnostics are memoized. Elective/
free-elective rules, offerings and calendar remain unvalidated, and all degree estimates
stay null. Guest/unassigned behavior and legacy intensity policy are retained. Twenty pure
and fourteen PostgreSQL API cases pass, with 55 existing planner/rating/access regressions.
Independent review's impossible-parent ranking gap was repaired and regression-covered.
Build/types/zero-warning lint and 682 server / 310 client tests pass for the isolated snapshot.
See docs/phase-2/curriculum-semester-preview.md. No assignment/record/plan/seed writes.

All auth user replies now expose stored curriculumId (explicit null when unassigned);
login/register/demo/me agree without JWT/body assignment claims or private password fields.
Session refresh reads current database context and role. Optional shared typing preserves
old caches/fixtures; context-aware clients must distinguish absent from confirmed null.
Eight PostgreSQL cases and existing auth/demo regressions pass; independent review found
no blocking source issue. Build/types/zero-warning lint and 690 server / 310 client tests
pass for this isolated snapshot. See docs/phase-2/session-curriculum-context.md.

Owner access guards now normalize UUID-shaped id/userId parameters before comparison
and downstream database queries. Uppercase UUIDs resolve consistently without allowing
student-ID aliases to impersonate another primary key; non-UUID aliases remain exact-case,
and direct userId routes still reject aliases. Eleven PostgreSQL cases plus auth/access
coverage pass 36 focused cases, including writes and unchanged saved histories. Independent
review found no blocker. Build/types/zero-warning lint and 701 server / 310 client tests pass
for the exact isolated snapshot. No schema, assignment, source or seed change was made.

The Planner now gates reads on a fresh cookie session with explicit curriculum metadata.
Assigned accounts render a validated, read-only reference preview with intensity selection,
scoped course/placement metadata, actual rating confidence, mandatory prerequisite blockers,
ignored historical selections and unresolved requirements. Invalid/stale/legacy replies
show retry without global fallback. Owner/intensity/request isolation and focus refresh
clear old results; confirmed null accounts retain the existing legacy workload/suggestions.
Twenty-nine dashboard cases and twenty-seven API-boundary cases pass. Build/types/zero-warning
lint and 701 server / 366 client tests pass for the exact isolated source snapshot. Desktop
and mobile browser checks with a disposable assigned account had no horizontal overflow,
44-pixel new controls and correct low-intensity blockers. Final review was inline after
subagents reached the account usage limit; this is not an independent review. See
docs/phase-2/curriculum-planner-client.md. No assignment API, selector or data reset was used.

Grade read/append summaries now expose validated current owner/context/GPA-fork metadata.
The dashboard rejects another scoped owner and explains member-only GPA, preserved history,
and nonfork policy. Five PostgreSQL, nine API and seven dashboard cases cover this increment.
Build/types/zero-warning lint and 706 server / 382 client tests pass for the isolated snapshot.
Desktop/mobile review of a disposable nonfork reference/account showed GPA 90 with all three
attempts preserved, including an excluded historical 100; no horizontal page overflow.
Review was inline after the account usage limit. See docs/phase-2/grade-summary-scope.md.

The grade-entry picker now reads cookie-account course choices in one repeatable-read
snapshot. Assigned choices contain only placed curriculum members; confirmed null accounts
retain the global basic list. Strict shared/API validation rejects another owner, duplicate
or malformed choices and extra global metadata. Loading, errors and empty contexts disable
new entry without fallback; focus/visibility refresh clears obsolete selections and rejects
stale responses. Historical attempts remain visible and exact-key pending recovery survives
an outside-current-context course without creating a new request. Eight PostgreSQL, eight
API and eight entry cases pass. Build/types/zero-warning lint and 714 server / 398 client
tests pass on the exact isolated snapshot. Desktop/mobile browser checks confirmed only the
member course, 44-pixel form controls and no horizontal overflow; read-only inspection
preserved all numeric attempts and legacy records. Review was inline after the account
usage limit. See docs/phase-2/grade-course-picker.md. This does not enable account assignment.

Protected My curriculum now confirms the fresh cookie owner/context before mounting a view.
Only an explicit null context mounts the existing editable map. Assigned accounts receive
strictly validated, read-only reference metadata: unique course identities, all repeated
placements, context-only mandatory prerequisites, difficulty estimates with real rating
counts/prior copy and unresolved free-elective requirements. No CS target, manual GPA choice,
global category/edge fallback or invented degree/calendar total is rendered for assigned
contexts. A second session check rejects context changes during the public reference read;
focus/visibility refresh, request generations and owner isolation withhold old results.
Three real PostgreSQL response-contract cases plus seventeen API and seventeen component
cases pass. Build/types/zero-warning lint and 717 server / 432 client tests pass on the exact
isolated source snapshot. Desktop/mobile review confirmed nonfork copy, member-only cards,
44-pixel reload and no horizontal overflow while preserving fixture history. Review was
inline after the account usage limit. See docs/phase-2/account-curriculum-reference.md.

Assigned references now include a private, read-only saved-progress summary with current
completed/planned/in-progress counts, earned credits excluding physical training, and
preserved outside-context records/claims shown separately. The existing private progress
endpoint adds its authoritative owner to scope from the same repeatable-read snapshot.
Strict shared/client validation rejects legacy replies, wrong owners/contexts, duplicate
records, invalid buckets, mismatched course identities and inconsistent earned totals.
Owner/context remounts and request generations withhold stale results and support retry;
the parent focus refresh remounts the summary. No percent, remaining-degree total or
progress mutation is added. Four PostgreSQL, nineteen API and ten summary cases pass.
Build/types/zero-warning lint and 721 server / 461 client tests pass on the exact isolated
snapshot. Desktop/mobile checks showed one current completed course/4 earned credits,
a preserved outside-context thesis record, 44-pixel reloads and no horizontal overflow;
all fixture attempts and legacy records remained unchanged. Review was inline after the
account usage limit. See docs/phase-2/context-progress-summary.md.

The read-only progress summary now lists current saved course identities, Completed/
In progress/Planned status and elective claims, sorted by code. It uses the same validated
private snapshot as counts; historical records remain separate. Loading/owner changes
withhold previous course rows. Two new component cases cover status/claim inspection and
late reload/account results. Build/types/zero-warning lint and 721 server / 463 client tests
pass on the exact isolated snapshot. Desktop/mobile browser checks showed the correct member
completion row with no horizontal overflow and unchanged fixture records/attempts. Review
was inline after the account usage limit. See docs/phase-2/context-saved-course-list.md.

Next: verify context-aware completion mutation/cache handling before enabling editing. Keep completion
editing gated until progress/cache hydration/types and pending mutations/claims are isolated
by owner and context. The old GPA hook is retained only within the confirmed-null legacy map.
Do not enable assignment yet. Remaining legacy consumers expect flat
profile/recommendation fields; the Planner preview now consumes its contextual DTO.
Preserve unrelated UI ownership. Assignment must
validate transferred completions/claims/cached plans and isolate caches and pending handlers
by account and context. Full degree planning requires verified elective/degree/offering
rules. Signed IT/DS reconciliation precedes the selector. Required school-admin resources/
allocation/dashboard, deployment and thesis remain outstanding.

Changes since the previous checkpoint:

- Archived account selections can be reviewed and imported with account-scoped recovery.
- Saved semester lists reject malformed, duplicate and unknown courses; earned-credit
  totals consistently exclude physical training while planned credits include it.
- Numeric 0–100 grade entry, immutable retake history, highest-score credit-weighted GPA
  and a protected Grades dashboard are shipped, including safe retry/tab recovery.
- Completed-course difficulty voting, private personal votes, persistent hourly limits,
  atomic cached counts/averages, Bayesian estimates and a protected Ratings screen are
  shipped. Course cards show estimates with actual vote counts and honest zero-vote copy.
- Workload recommendations, semester ranking, saved-plan totals and curriculum highlights
  consume rating estimates. Course projections share consistent database snapshots.
- The duplicated semester RULES array is removed; every database prerequisite is mandatory
  and scheduled parents unlock dependents only in later semesters. Incomplete schedules
  list unscheduled courses and withhold misleading completion/graduation estimates.
- Curriculum highlights count duplicate elective placements once and preserve both GPA
  paths before spending credits. Desktop/mobile browser checks covered the changed scope.

Resume with small, separately verified increments in this order:

1. Server-computed GPA path is implemented in grade summaries: `>70` thesis, `<=70`
   alternative, null without eligible scores. Decimal weighted totals prevent binary
   arithmetic from misclassifying exact 70; highest retakes and PT exclusions remain.
   The earlier draft is superseded. GET/POST API summaries share this cookie-account policy.
2. Curriculum Y4S2 rendering is implemented: the server path selects Thesis/alternative,
   recommendation budgets and the 41/43-course target. Guests and confirmed-null numeric
   GPA retain manual choice; loading/error exposes no editable courses. 39 new client
   cases cover validation, stale accounts/handlers, retry and focus refresh without losing
   progress. Desktop/mobile browser checks confirm the 84.29 Thesis path and no page overflow.
3. Numeric grade fit is implemented: highest 0–100 course scores, credit weighting,
   PT/zero-credit exclusion, matching existing requirement category and Bayesian difficulty.
   A bounded bonus uses configurable weight (default 2, 0–20) and distance (default 0.5,
   0–4); zero weight disables it. Legacy grade metadata is preserved, never converted.
   The server GPA path now filters recommendation availability before ranking and
   credit budgeting. Protected Planner now activates the workload/recommendation screens. Null numeric
   GPA currently retains both server options; the map still permits manual choice.
   Course categories are requirement types, not subject disciplines. Subject-specific
   personalization needs verified metadata. Preserve pending UI ownership when adding routes.
4. Implement curriculum context safely: additive Curriculum/CurriculumCourse migrations,
   context-specific prerequisites, CS backfill, then reconcile/validate signed IT and DS
   sources before seeding and adding the major selector. Resolve curriculum-specific
   rating priors here; do not union prerequisites across majors.
5. Implement required school-admin resources, demand/capacity, configurable multi-objective
   scoring and scarcity allocation with a real dashboard. Deployment and thesis writing
   follow their gates; neither is complete.

The full Grades and Ratings roadmap phases are not complete: verified semester planning,
curriculum priors and multi-objective scoring remain outstanding.
Later UI finish reviews used a disclosed inline fallback after subagents hit
an account usage limit; they must not be represented as independent agent reviews.

## Locked Architectural Decisions

These are settled. Do not relitigate without new evidence.

| ID     | Decision                                                                                                                        | Rationale                                                                                                                                                                                                                                         |
| ------ | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D1** | `Course` is **global**; curriculum membership uses `CurriculumCourse`, repeated placements use child `CurriculumPlacement` rows | `MA001IU` appears in nearly every program. Global rows avoid ~60% duplication, and one rating average serves all programs. Year/semester placement is _per-curriculum_ (Calculus is Y1S1 for CS, Y2S1 for Business) so it cannot live on `Course` |
| **D2** | `CurriculumGraph.tsx` is **deleted**; drop `@xyflow/react`, `dagre`, `@types/dagre`                                             | 272 lines of dead code duplicating the column layout. Only source of `@xyflow/react` and `dagre` imports in the repo. `react-router-dom` stays and becomes the real nav backbone                                                                  |
| **D3** | Auth token in an **httpOnly cookie**, not localStorage                                                                          | Not readable by JS, so XSS cannot exfiltrate it. Makes `credentials: true` (already in `server/src/index.ts`) load-bearing. Requires `cookie-parser` + CSRF mitigation (`SameSite=Lax` or double-submit)                                          |
| **D4** | `Course.difficultyLevel` is **retained** as the Bayesian prior `m`                                                              | Never deleted. The seed heuristic (`seed.ts:40`) becomes the cold-start prior, not dead data                                                                                                                                                      |
| **D5** | Remove the `RULES` array in the recommendation phase; prerequisite data must live only in the DB                                | The duplicated semester-planner array has been removed. Every database prerequisite is mandatory under the confirmed policy, regardless of legacy strict/corequisite flags                                                                        |
| **D6** | Server is **authoritative** for completion + cascade                                                                            | Client BFS is optimistic UX only. A client must not be able to complete a course whose strict prerequisites are unmet                                                                                                                             |
| **D7** | `PlannedSemester.courses` stays `Json`                                                                                          | Escaped by `@@unique([studyPlanId, semester, year])`; no query needs to index into it. Do not migrate to a join table                                                                                                                             |
| **D8** | Phase 4 (School Admin) is **required**, not stretch                                                                             | Confirmed with supervisor. It is the multi-stakeholder contribution that distinguishes the thesis                                                                                                                                                 |

## Target Schema (post-Phase-1)

```prisma
enum UserRole { STUDENT ADMIN }

model Curriculum {
  id            String   @id @default(uuid())
  code          String   @unique        // "CS", "IT", "BA"
  name          String                  // "Computer Science"
  school        String
  degree        String
  programUrl    String   @map("program_url")
  totalCredits  Int      @map("total_credits")
  isGpaPath     Boolean  @default(false) @map("is_gpa_path")  // Y4S2 GPA fork
  courses       CurriculumCourse[]
  resources     SchoolResource[]
}

model CurriculumCourse {          // NEW — join table, decision D1
  id                 String   @id @default(uuid())
  curriculumId       String
  courseId           String
  academicYear       Int?     @map("academic_year")
  academicSemester   Int?     @map("academic_semester")
  electiveGroup      String?  @map("elective_group")
  electiveSelectCount Int?    @map("elective_select_count")
  curriculum         Curriculum @relation(..., onDelete: Cascade)
  course             Course     @relation(..., onDelete: Cascade)
  @@unique([curriculumId, courseId])
  @@index([courseId])
}

model Course {
  // existing fields UNCHANGED except: drop academicYear, academicSemester,
  // electiveGroup, electiveSelectCount (moved to CurriculumCourse)
  avgRating   Float? @map("avg_rating")     // cached, Phase 3
  ratingCount Int    @default(0) @map("rating_count")
  ratings     CourseRating[]
}

model User {
  passwordHash String?  @map("password_hash")   // replaces unused `password`
  role         UserRole @default(STUDENT)
  curriculumId String?  @map("curriculum_id")
}

model StudentRecord {
  electiveGroup String? @map("elective_group")  // claim must round-trip (D6)
}

model CourseRating {          // Phase 3
  userId    String
  courseId  String
  rating    Int                              // 1-5, validated by Zod
  @@unique([userId, courseId])
  @@index([courseId])
}

model SchoolResource {        // Phase 4
  curriculumId         String
  semester             Semester
  year                 Int
  professors           Int    @default(0)
  classrooms           Int    @default(0)
  labRooms             Int    @default(0) @map("lab_rooms")
  maxStudentsPerSection Int   @default(40) @map("max_students_per_section")
  courseOverrides      Json   @map("course_overrides")  // { [code]: { capacity?, professorCount? } }
  @@unique([curriculumId, semester, year])
}
```

**Migration order matters.** Phase 1 = two migrations: (1) add nullable columns + new tables,
(2) backfill from `Course.academicYear`/`electiveGroup` into `CurriculumCourse`, then add
constraints. One combined migration table-rewrites and loses rollback safety.

## Redundant Index Cleanup (Phase 1, same migration)

Drop these — each is write amplification with no read benefit:

| Table             | Drop                                       | Why                                                       |
| ----------------- | ------------------------------------------ | --------------------------------------------------------- |
| `courses`         | `@@index([code])`                          | `code` is `@unique` — Postgres already built the index    |
| `users`           | `@@index([studentId])`, `@@index([email])` | both `@unique`                                            |
| `prerequisites`   | `@@index([courseId])`                      | leftmost prefix of `@@unique([courseId, prerequisiteId])` |
| `student_records` | `@@index([userId])`                        | leftmost prefix of `@@unique([userId, courseId])`         |

Keep `@@index([prerequisiteId])` (reverse lookup, not covered). Verify with
`SELECT indexrelname, idx_scan FROM pg_stat_user_indexes;` before dropping anything.

## Target API Surface

```
POST   /api/auth/register            → 201 { token(set-cookie), user }
POST   /api/auth/login               → 200 { user }
POST   /api/auth/logout              → 204
GET    /api/auth/me                  → 200 { user }

GET    /api/curriculums                      → all programs
GET    /api/curriculums/:id/courses          → CurriculumCourse-joined course list

GET    /api/users/me/progress          → hydrate store on login
POST   /api/users/me/progress          → { completedIds, plannedIds } additive archived-selection import
POST   /api/users/me/complete          → { courseId, grade?, semester?, year? }
                                         → validates strict prereqs, returns cascade set

GET    /api/users/me/grades            → numeric attempt history + highest-score GPA and coverage
POST   /api/users/me/grades            → { courseId, requestId, score, semester?, year? }

POST   /api/courses/:id/rate           → auth + must have COMPLETED record; upsert
GET    /api/courses/:id/ratings        → { average, count, distribution{1..5} }

POST   /api/admin/resources           → requireAdmin
GET    /api/admin/resources           → requireAdmin
```

All mutating routes require `requireAuth`. `/api/admin/*` requires `requireAdmin`.

## Recommendation Engine (Phase 3 + 4)

### Difficulty: Bayesian shrinkage, not fallback

A course with zero ratings must not silently use the raw seed heuristic. Shrink toward the
curriculum mean:

```
displayed = (v * n + m * C) / (n + C)
```

`v` = course average, `n` = rating count, `m` = curriculum mean (fallback to global mean when a
curriculum has no rated courses), `C` = prior strength (5). At `n=0` you get `m`; by `n=50` the
prior is washed out. Always surface `n` next to the score so users can judge confidence.

Consume the shrunk value in place of `course.difficultyLevel` at `workloadBalancer.ts:123`,
`:140` and `semesterPlanner.ts:133`, plus the client-side scorer in
`CurriculumProgressMap.tsx:98-199`.

### Scoring: multi-objective

Replace the single `priorityScore` (`workloadBalancer.ts:111-145`) with a weighted combination.
Weights live in `server/src/config/index.ts`, **not** in scoring code, so policy is a deployment
decision:

```
final = α·studentUtility + β·resourceFit + γ·fairness
α = 0.60   β = 0.25   γ = 0.15
```

- `studentUtility` — category weight, unlock count, grade fit
- `resourceFit` — penalize `max(0, utilization - 0.85)`; hard-exclude at `utilization >= 1` when
  the student has alternatives
- `fairness` — when oversubscribed, rank by **scarcity** (fewest remaining options first), not by
  click order

`utilization = demand / supply`, `supply = classrooms × maxStudentsPerSection` (plus lab rooms for
lab courses), `demand` = students with the course PLANNED or recommended.

Batch allocation is a background job per cohort (Hungarian is overkill; greedy ordered by scarcity
converges). The synchronous `GET /api/recommendations/user/:userId` stays as the fallback.

## Phase Schedule

| Weeks | Phase                                                | Gate — must be true to advance                        |
| ----- | ---------------------------------------------------- | ----------------------------------------------------- |
| 0     | Extract + verify curriculum URLs                     | Verification script run reports per-URL parse results |
| 1     | Sign-off, schema migration, auth backend             | register/login works via curl                         |
| 2–3   | Multi-curriculum: scraper, seed, API, selector       | switch major → different curriculum renders           |
| 4–5   | Server-backed progress, cascade-on-server, login E2E | logout → login → progress intact                      |
| 6–7   | Grades, GPA dashboard, activate dead components      | GPA correct; invalid completion blocked               |
| 8–9   | Ratings: schema, API, shrinkage, UI, engine          | cold-start course shows curriculum mean               |
| 10–11 | Admin: resources, demand, multi-objective, dashboard | oversubscribed course redistributes                   |
| 12–13 | Tests, deployment, thesis chapters                   | demo works; thesis compiles                           |

Scope target: **8–12 curricula** seeded, architecture supports all 23. Demo with 3–4.
Write thesis chapters in parallel — do not batch all writing into week 13.

## Scraper Verification Gate (Week 0 — blocks Phase 1)

`scripts/scrapeCourses.js` assumes, and other IU programs may violate:

- Course ID regex `/^[A-Z]{2,}\d{3,4}IU$/` (line 93) — confirm `BA`/`MK`/`FN`/`AC` prefixes
- Year header regex uses an **en dash** `–` (line 44), not a hyphen — other school pages often
  use `-`, which would break year detection entirely
- Requires **≥5 cells** per row (line 93) — other layouts may emit 4 or 6
- Hard bounds `year <= 4 && semester <= 3` (line 102)

Before writing the real scraper, run a throwaway verification script over every target URL
reporting: tables found, course-ID matches, which dash characters appear in year headers, credits
parsed, and course-looking rows that were skipped. If output shows one parser will not serve all
schools, write per-school-family parsers. Discovering this in week 0 costs 2 days; discovering it
in week 3 costs a blown phase.

Generalized target signature:

```js
scrapeCurriculum({ url, code, name, school, degree, outPath });
// → server/prisma/data/curricula/<code>.json
//   { code, name, school, degree, programUrl, semesters: [...] }
```

`scripts/validateCurriculum.js` is a **hard gate** before seeding: asserts credit total, no
duplicate codes, no dangling prerequisite codes, `year ∈ 1..4`, `semester ∈ 1..3`.

## Testing Priorities

Current suites contain 721 server tests and 463 client tests. Continue prioritizing what can silently corrupt data:

1. **Cascade** (`workloadBalancer`/`users` complete route) — complete → uncomplete → transitive
   dependents drop; corequisite handling; cycle safety
2. **Bayesian shrinkage** — `n=0`, `n=1`, `n=50` against hand-computed values
3. **Allocation** — oversubscribed course, scarcity ordering
4. **Auth** — duplicate register, bad password, expired token, role guard
5. **Curriculum isolation** — switching major never leaks another major's courses
6. **Store** — optimistic update, reconcile, rollback on failure
7. **Sidebar rescale guard** — the `wasSidebarOpen` ref is subtle and untested

Server tests run against **real PostgreSQL** (docker must be up), not mocks.

## Roadmap Hygiene

- Keep this file truthful. When a phase lands, update the affected line rather than appending a
  correction — a stale "ignore this error" note costs more than it saves
- Per-phase `docs/phase-N/` notes are acceptable; delete them once the phase is in this file
- The `Rating` badge, `Resource` badge, and admin nav are user-visible proof that roadmap work
  shipped — do not stub them

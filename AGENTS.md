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
- **Routing**: `react-router-dom` — `/` demo, `/login`, `/register`, protected `/curriculum` and `/grades`. The Grades dashboard shows numeric GPA and retake history; numeric grade entry is available; the admin dashboard remains pending.
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
- Toggle lives under the Y4S2 column header, affects only that column

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

| Area                           | Shipped / verified                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Remaining                                                                                                                                                 |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Client foundation              | Dead graph/elective selector removed; build/type/lint clean; prerequisite locking and cycle-safe optimistic cascades; Y4S2 recommendations respect both GPA paths before counting credits                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Activate workload/recommendation/grade screens as their APIs land                                                                                         |
| Auth and demo roles            | Cookie register/login/logout/me; ownership/admin guards; session recovery even when browser storage is denied; development-only demo student/admin buttons; header role                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | School-admin dashboard and production deployment                                                                                                          |
| Student progress               | Authenticated `/users/me/progress` and `/users/me/complete`; elective claim column; mandatory prerequisite validation; transaction cascade; browser hydration, optimistic saves, reconciliation, rollback/recovery, account isolation, cache backups; owner/admin guards for legacy student, study-plan and personalized recommendation reads; additive archived-selection import API with atomic prerequisite/cycle validation; validated account-scoped browser import action, confirmed-state reconciliation and backup-preserving recovery; inline archived course/claim review, explicit import/Later controls and prerequisite/context blockers; profile/progress completed credits consistently exclude physical training | Multi-curriculum context for import claims                                                                                                                |
| Study plans                    | Legacy semester create/update rejects duplicate and unknown course IDs atomically before saving; UUID normalization, strict fields and authoritative credit/difficulty totals                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Activate planner UI and recommendations                                                                                                                   |
| CS/IT/DS source gate           | User-supplied official CSE page reviewed; signed 2024/2025 curriculum links identified; existing CS JSON retained as attribute/layout reference                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Reconcile signed PDFs with conflicting HTML; validate and seed IT/DS; implement multi-curriculum schema/API/selector                                      |
| Grades and GPA                 | Existing grade metadata preserved by completion updates; tested numeric 0–100 GPA calculator, highest score per course, credit weighting and physical-training exclusion; additive immutable numeric GradeAttempt history with account-scoped retry keys; authenticated numeric grade history/append APIs with consistent summaries and explicit coverage gaps; protected Grades dashboard with retake history, loading/retry states and account isolation; numeric grade entry with account-scoped tab recovery, immutable retry keys and full-snapshot reconciliation                                                                                                                                                          | Server-driven GPA path                                                                                                                                    |
| Ratings and recommendations    | Seed difficulty prior retained; pure Bayesian shrinkage helper with prior strength 5, zero-rating mean behavior and confidence count; additive global CourseRating rows with unique account/course votes, 1–5 checks and atomic cached averages/counts, including concurrent writes and FK deletion; public consistent rating summaries with global prior resolution and Bayesian estimates; completion-gated cookie-authenticated upserts and durable configurable hourly quota, idempotent unchanged retries; batched, snapshot-consistent difficulty/count projections in course lists, detail and curriculum rows; visible difficulty/count badges with honest zero-vote copy                                                                                                                                                                                                                   | Rating entry UI, curriculum-specific prior resolution and engine shrinkage integration, remove hardcoded `RULES`, server scoring integration |
| School admin                   | Real ADMIN role and demo session                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Resources, demand, scarcity allocation, multi-objective scoring, dashboard — required                                                                     |
| Verification/deployment/thesis | Real PostgreSQL and client regression suites; shared-first root builds/typechecks/tests; concurrent local startup; Docker shared builds with isolated compiled output; local Docker smoke checks                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Deployment gate and thesis chapters                                                                                                                       |

Full phases are **not** marked complete: curriculum context, grades,
ratings, and resource allocation are still outstanding. The user explicitly prioritized
feature increments before extending curriculum coverage.

Source notes: `docs/phase-1/cse-curriculum-sources.md`. Signed 2025 documents differ
from page HTML in credits, course codes, and elective rules. IT has Network Engineering
and Computer Engineering tracks. Some shared courses have different prerequisites
across majors; retain global Course identities but resolve prerequisites in curriculum
context before seeding IT/DS. Do not union prerequisite sets across majors.

Current verification: 301 server tests and 153 client tests (integration suites use real PostgreSQL), covering cookie/role access,
mandatory prerequisites, transactional cascades, optimistic store saves, failure recovery,
stale account responses, legacy cache backups, guest isolation, and legacy read ownership/role guards, additive import validation/concurrency, denied-storage session recovery, and GPA recommendation budgets. Re-run quality gates
before each commit; keep these counts current when tests change.

Local startup verification: root build and dev work without existing `shared/dist`;
frontend/backend respond on separate test ports; one Ctrl-C stops all three watchers
without leaving processes or listening ports. Docker images build from clean source,
and backend curriculum reads work with the source bind mount and isolated shared output.

Remaining stabilization findings: partially populated database seed behavior,
legacy semester course-list validation, physical-training totals in legacy profile stats,
and the sidebar overlay/pan bounds in uncommitted interface work. Those interface
edits are preserved separately from the narrow auth/GPA fixes.

## Locked Architectural Decisions

These are settled. Do not relitigate without new evidence.

| ID     | Decision                                                                                         | Rationale                                                                                                                                                                                                                                         |
| ------ | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D1** | `Course` is **global**; placement lives in a `CurriculumCourse` join table                       | `MA001IU` appears in nearly every program. Global rows avoid ~60% duplication, and one rating average serves all programs. Year/semester placement is _per-curriculum_ (Calculus is Y1S1 for CS, Y2S1 for Business) so it cannot live on `Course` |
| **D2** | `CurriculumGraph.tsx` is **deleted**; drop `@xyflow/react`, `dagre`, `@types/dagre`              | 272 lines of dead code duplicating the column layout. Only source of `@xyflow/react` and `dagre` imports in the repo. `react-router-dom` stays and becomes the real nav backbone                                                                  |
| **D3** | Auth token in an **httpOnly cookie**, not localStorage                                           | Not readable by JS, so XSS cannot exfiltrate it. Makes `credentials: true` (already in `server/src/index.ts`) load-bearing. Requires `cookie-parser` + CSRF mitigation (`SameSite=Lax` or double-submit)                                          |
| **D4** | `Course.difficultyLevel` is **retained** as the Bayesian prior `m`                               | Never deleted. The seed heuristic (`seed.ts:40`) becomes the cold-start prior, not dead data                                                                                                                                                      |
| **D5** | Remove the `RULES` array in the recommendation phase; prerequisite data must live only in the DB | Removal is still pending. Every prerequisite is mandatory under the confirmed policy, regardless of legacy strict/corequisite flags                                                                                                               |
| **D6** | Server is **authoritative** for completion + cascade                                             | Client BFS is optimistic UX only. A client must not be able to complete a course whose strict prerequisites are unmet                                                                                                                             |
| **D7** | `PlannedSemester.courses` stays `Json`                                                           | Escaped by `@@unique([studyPlanId, semester, year])`; no query needs to index into it. Do not migrate to a join table                                                                                                                             |
| **D8** | Phase 4 (School Admin) is **required**, not stretch                                              | Confirmed with supervisor. It is the multi-stakeholder contribution that distinguishes the thesis                                                                                                                                                 |

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

Current suites contain 301 server tests and 153 client tests. Continue prioritizing what can silently corrupt data:

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

# IU Smart Study Planner

A thesis project for International University, VNU-HCMC: track course progress, record
numeric grades and retakes, rate course difficulty, and explore study-plan references
and simulated school resource allocation.

The working curriculum is a **Computer Science reference**. Verified CS, IT and DS
curriculum sources, assignment and a major selector remain pending. Admin allocation
is a **simulation**, with no enrollment or student information system integration.
See [AGENTS.md](AGENTS.md) for shipped checkpoints and remaining roadmap gates.

## What the app currently does

- **Curriculum:** custom semester columns with pan/zoom, prerequisite hints, elective
  groups, completion and planned-course states. Anonymous progress stays in that browser.
- **Accounts:** registration, sign-in/out and protected pages with an HTTP-only session
  cookie. Signed-in progress is server-backed, with account isolation, prerequisite
  cascades, archived browser-progress review/import, and recovery after failed saves.
  Assigned reference curriculum views are currently read-only.
- **Grades:** enter actual scores from 0–100. Attempts are immutable; retakes preserve
  history and the highest score per course determines credit-weighted numeric GPA.
  Physical training is excluded from earned credits and GPA. Legacy letter grades are
  preserved without guessed numeric conversions.
- **GPA path:** signed-in numeric GPA uses the server's exact `>70` thesis rule; rounded
  display values never decide eligibility. Guests and accounts with no numeric GPA can
  use the manual reference toggle. Loading/error states block dependent edits.
- **Ratings:** students rate completed courses from 1–5, see their votes and vote counts,
  and receive Bayesian difficulty estimates used in workload recommendations.
- **Planner:** workload/recommendation views, selected-course reference previews, and
  saved-plan/semester/course browsing. Eligible assigned-context saved semesters offer
  selection editing, proposed-course blockers, revision conflicts, unsent draft recovery,
  safe exact retries, and Move up/down display ordering.
- **School admin:** simulated resource entry, demand/capacity diagnostics, allocation
  previews, captures, queued execution and history. Students can inspect their own
  available simulation results. Labels explain the limits of each reference.

All prerequisite rows are mandatory under current policy, including legacy recommended
and corequisite rows. Another course in a saved selection does not satisfy a missing
completed prerequisite. Display ordering does not change academic chronology or priority.

These features do not yet establish a verified degree plan, timetable, lab/staff schedule,
curriculum activation, production deployment or institutional adoption.

## Run locally on a MacBook

Install Docker Desktop and Node **24.22.0** with its bundled npm **11.19.1**. The exact
Node version is in [.nvmrc](.nvmrc); if you use nvm, run `nvm install` then `nvm use` from
the repository folder. Keep Docker Desktop open.

### First setup: local Node apps and Docker PostgreSQL

Open a terminal in this repository, then run:

```bash
# Start only the database; existing data is retained.
docker compose up -d postgres

# Install the exact dependencies recorded in the root lockfile.
npm run install:all

# Create environment files only when they do not already exist.
cp -n server/.env.example server/.env
cp -n client/.env.example client/.env

# Generate the database client and apply reviewed migrations.
npm run db:generate --workspace=server
npm exec --workspace=server -- prisma migrate deploy

# FIRST SETUP ONLY: populate an empty database with reference sample data.
npm run db:seed --workspace=server

# Build shared schemas, then start the shared/client/server watchers.
npm run dev
```

Open [the app](http://localhost:5173). The API runs on port 3001 and PostgreSQL on 5432.
Keep the terminal running. Press Ctrl-C once to stop the application watchers;
PostgreSQL keeps running separately.

For later sessions, keep Docker Desktop open, run `docker compose up -d postgres` and
`npm run dev`. There is no need to reinstall or seed every time. `install:all` runs
`npm ci` and replaces node_modules; stop local watchers before reinstalling a checkout.
Restart the dev command after changing shared schemas so the backend reloads imports.

Never overwrite an existing `.env` or commit its secrets. The examples configure local
development only. The seed skips once any user exists; it does not repair a partially
populated database. The sample account is not a password-based login credential, and
new/demo accounts do not automatically own the seed's saved plan or a verified context.

### Alternative: run the full development stack in Docker

Use this instead of local Node watchers, since both options use ports 5173 and 3001.
Stop local watchers first, then run:

```bash
docker compose up -d --build
docker compose logs -f backend
# Ctrl-C exits the logs while containers keep running.

# FIRST SETUP ONLY, for an empty database:
docker compose exec backend npm run db:seed
```

The backend applies reviewed migrations with `prisma migrate deploy`; startup does not
seed or reset data. `docker compose down` stops the stack and preserves its database
volume. To switch back to local Node, stop only the app containers with
`docker compose stop frontend backend`, then use `npm run dev`.

These Dockerfiles run development watchers. They are not a production hosting recipe.

## Local demo checklist

Development builds expose quick **Student** and **School admin** login buttons when the
API's development demo endpoint is enabled. Otherwise, create an account normally.
Demo login is unavailable in production.

- [ ] Open the anonymous curriculum: columns, pan/zoom, locked prerequisite hints and
      elective sidebar work.
- [ ] Complete an unlocked demo course; plan/unplan it. Uncomplete a prerequisite and
      verify that completed dependent courses also become incomplete.
- [ ] Sign in as a student. Check Grades, Ratings, Planner and My curriculum navigation.
      Reload and sign out/in; confirmed account progress persists.
- [ ] Complete an eligible account course and enter a numeric grade, then a retake.
      Both attempts remain visible and the highest score drives numeric GPA.
- [ ] Rate a completed course; check your vote and the displayed vote count.
- [ ] Open Planner. Workload results, explicit blockers and honest empty states are
      valid; a fresh account may have no saved plan or simulation history.
- [ ] Sign out and use the school-admin demo. Check simulation labels and resource
      controls. An unconfigured context can produce an explicit empty state.
- [ ] Switch accounts and confirm progress, grades, drafts and private saved history
      do not leak between accounts.
- [ ] Only with an already provisioned assigned-context/saved-semester test fixture:
      inspect proposed blockers, reorder a selection, save/reload, and explicitly
      restore a matching unsent draft. Do not activate or self-assign an unverified
      curriculum merely to enable this test.

## Development and checks

| Command                                        | Purpose                                                |
| ---------------------------------------------- | ------------------------------------------------------ |
| `npm run dev`                                  | Build shared, then watch shared/client/server together |
| `npm run dev:frontend` / `npm run dev:backend` | Shared watcher plus one app                            |
| `npm run build`                                | Shared first, then both production builds              |
| `npm run typecheck`                            | Type-check every workspace                             |
| `npm run lint`                                 | Lint every workspace with zero warnings allowed        |
| `npm run format:check`                         | Check maintained source, docs and YAML formatting      |
| `npm test`                                     | Startup lifecycle, server Jest, then client Vitest     |

Server tests use **real PostgreSQL** and create/delete fixture data. Use a dedicated
verification database with reviewed migrations and the reference seed, not your personal
application database. Suites run sequentially; explicit race cases still run concurrently.
Client interaction tests use jsdom and do not prove real browser geometry.

GitHub runs a clean locked install and all quality gates on PRs and main pushes, using
its own disposable PostgreSQL service. See [CI and reproducible installs](docs/phase-5/continuous-integration.md).
For dependency updates, use the pinned Node/npm pair and commit the manifests plus
root [package-lock.json](package-lock.json). Ordinary setup uses `npm ci`.

## Architecture

| Area    | Tools and source                                                       |
| ------- | ---------------------------------------------------------------------- |
| Client  | React 18, Vite 5, TypeScript, Tailwind 3, Zustand 4, React Router 6    |
| Server  | Express 4, Prisma 5, PostgreSQL 15, cookie sessions and Zod validation |
| Shared  | Zod schemas and TypeScript DTOs compiled before their consumers        |
| Tests   | Node startup cases, Jest/ts-jest/Supertest, Vitest/jsdom               |
| Tooling | npm workspaces, ESLint, Prettier, Docker Compose, GitHub Actions       |

The lockfile records exact dependency versions. The curriculum uses a custom CSS
semester-column layout; React Flow and dagre were removed.

```text
client/src/
  context/                 Session state and recovery
  features/auth/           Login, registration and route guards
  features/curriculum/     Reference graph and account curriculum view
  features/grades/         Numeric attempts and GPA
  features/ratings/        Completed-course difficulty voting
  features/planner/        Workload, saved references and recoverable editing
  features/admin/          Simulation resources and allocation workflow
  lib/                     API clients, runtime validation and progress store
server/
  src/routes/              Authenticated API endpoints and access rules
  src/services/            GPA, progress, recommendations and simulation logic
  prisma/schema.prisma     Current data model
  prisma/migrations/       Reviewed additive migrations
shared/src/                Shared runtime contracts and DTOs
scripts/                   Development lifecycle and source verification tools
docs/                      Feature checkpoints and verification notes
.github/workflows/         Automated quality checks
```

See the [database schema](server/prisma/schema.prisma) for account/curriculum membership,
progress, immutable grade attempts, ratings, saved plan references, simulation resources
and allocation history. Course identities are global; contextual placements, prerequisite
edges and requirements belong to a context. Context references do not imply activation.

## API overview

All paths below start with `/api`. See [route registrations](server/src/index.ts) and
[shared contracts](shared/src) for exact bodies, response schemas and access policies.

| Route family                               | Purpose and access                                                                |
| ------------------------------------------ | --------------------------------------------------------------------------------- |
| `/auth/*`                                  | Register, cookie login/logout and current session; demo login development-only    |
| `/courses`, `/curricula`                   | Catalog and reference contexts; course writes require admin                       |
| `/users/me/progress`, `/users/me/complete` | Current-account progress and mandatory cascade rules                              |
| `/users/me/grades`, `/users/me/ratings*`   | Current-account numeric history and difficulty voting reads                       |
| `/courses/:id/rate`                        | Rate an eligible completed course while signed in                                 |
| `/users/me/study-plans/*`                  | Own saved references, current reviews and scoped selection editing                |
| `/users/me/semester-allocation-runs/*`     | Own available simulation history/results                                          |
| `/recommendations/*`                       | Recommendation/workload and reference preview APIs, with endpoint-specific access |
| `/admin/*`                                 | ADMIN-only simulation resources, allocation and history                           |
| `/users/:id`, `/study-plans/*`             | Legacy reads/writes with owner/admin access rules                                 |

Most feature endpoints use `{ success, data?, error? }`. Health returns its own status
object; successful logout returns 204 without a body. Requests use cookies with
`credentials: 'include'`; tokens are not stored in localStorage. Signed-in progress caches are
account-scoped and accepted only after a fresh scope check; saved-selection recovery binds
its account, curriculum, plan and semester.

## Reference data and remaining work

The seed consumes the checked-in [CS reference source](scraped-courses.json). The verifier
preserves 71 nonempty placements across 56 course identities; placements, unique catalog
courses and degree requirements are different counts. Existing CS data is an extraction
reference for IT/DS, not proof that all signed curriculum rules have been reconciled.

Features come first, using simulated students. Official CS/IT/DS source reconciliation,
verified assignment/switching, full degree/calendar planning, real staff/lab constraints,
production hosting and thesis evaluation remain separate gates. Follow the current
[roadmap checkpoint](AGENTS.md) instead of treating reference outputs as validated plans.

## Troubleshooting

- **Cannot connect / loading curriculum:** check Docker Desktop, the PostgreSQL container,
  the dev terminal and [API health](http://localhost:3001/api/health). Reload after recovery.
- **Ports already in use:** use one app startup option at a time. Stop your own old dev
  terminal or Compose app services; keep the existing database volume.
- **Shared types look stale:** rebuild shared with `npm run build:shared`, then restart
  the dev watchers. Root build/typecheck/test commands already build shared first.
- **CORS or cookie failures:** match `CORS_ORIGIN` in `server/.env` to the frontend origin
  and the client API URL to port 3001. Recheck the session after the API recovers.
- **No saved plan or curriculum context:** this can be a valid fresh-account state.
  Seeding an existing account database is not a repair mechanism.

Do not reset the database, remove its volume or delete containers as routine troubleshooting.

## Contributing

Use small branches and conventional commits (`feat:`, `fix:`, `test:`, `docs:`, `chore:`).
Read [AGENTS.md](AGENTS.md), preserve unrelated work, and pass the quality checks before
merging a PR. TypeScript is strict; avoid `any` and do not suppress hook dependency checks.
Create a repository issue for support.

## License and acknowledgments

Licensed under the [MIT License](LICENSE). Curriculum source material comes from
International University, VNU-HCMC. The application uses the open-source tools listed
above; the reference data does not imply institutional adoption.

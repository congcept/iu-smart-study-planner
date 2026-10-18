# CI and reproducible installs

The root npm workspace lockfile now records exact package versions, registry URLs and
integrity hashes. Use Node 24.22.0 (`.nvmrc`) and bundled npm 11.19.1 (`packageManager`).
`npm run install:all` runs `npm ci`; it fails on manifest/lock disagreement and replaces
node_modules. Stop existing watchers before reinstalling that checkout. Dependency updates
use `npm install` on this runtime and commit both manifests and the root lockfile.
Nested workspace lockfiles remain ignored.

The candidate lock was reconciled in a clean tracked-source copy without node_modules:
only root engines metadata changed; all 834 existing dependency/workspace entries stayed
unchanged. Official Node download checksums and action commit references were verified.
No user app dependencies, global runtime, database, curriculum or environment file changed.

## Automatic quality job

`.github/workflows/ci.yml` runs every pull request, main push and manual dispatch. One
complete job covers the coupled workspaces, including root/shared/tooling changes, without
path-filter omissions. It uses Ubuntu 24.04, exact action commit SHAs, no persisted checkout
credentials and read-only repository permissions. Older runs on the same PR/ref are canceled.

1. Assert exact Node and npm versions, then install from the lock with npm ci.
2. Explicitly generate Prisma, then build shared and both production applications.
3. Run workspace type checks, zero-warning lint and source/configuration formatting.
4. Apply reviewed migrations with migrate deploy and seed the empty PostgreSQL 15 service.
5. Run startup lifecycle cases, real PostgreSQL Jest suites, and client Vitest suites.

The workflow's fixed database credentials and JWT secret are test fixtures. The PostgreSQL
service is created for the job and discarded afterward. No deployment, app database,
repository write permission, production secret or real student data is needed. Pull requests
run their own untrusted source with a read-only token; no pull_request_target trigger.

Both development Dockerfiles use the same exact Node release and locked workspace install.
Automatic Prisma install hooks are skipped in the dependency-only layer because the schema
has not been copied yet. The server generates Prisma explicitly after copying its schema;
shared compilation and the existing paired development watchers are preserved.

## Verification and limits

Fresh macOS installation on the pinned runtime, production build, types, zero-warning lint
and formatting pass. The complete unchanged rerun passes 105 server suites/2915 real
PostgreSQL tests, 91 client suites/2248 tests and 10 startup lifecycle cases. Both current-source
Alpine image builds and isolated client/server production builds with networking disabled
pass; each image reports Node 24.22.0/npm 11.19.1. The corrected actual Ubuntu run
[39119579402](https://github.com/congcept/iu-smart-study-planner/actions/runs/39119579402)
passes all gates; [PR #132](https://github.com/congcept/iu-smart-study-planner/pull/132)
is merged with an exact-tree verification.

The first local complete run had two transaction-start timeouts. Both affected suites
(62 tests) and read-only concurrent transaction probes on Node 24 and 25 passed unchanged.
After Docker builds finished, the full unchanged suite passed. The original cause is
unconfirmed; no test assertion, concurrency case or transaction limit was weakened.
No UI behavior changed, and this does not complete the deployment or curriculum source gates.

Package dependencies and the Node release are locked. Runner images, PostgreSQL major and
Alpine tag contents can still receive updates; this is not a byte-identical whole-system
image. Existing dependency deprecation notices are retained for a separate reviewed upgrade.
Nine existing source/documentation formatting failures were corrected with Prettier only.
The original historical conversation export is excluded explicitly, as are generated dist
files. The format scripts now also include YAML, covering the workflow itself. No application
logic was changed by these corrections.

Next: keep the README aligned with current source, then implement the bounded production
frontend-origin preflight. Source/assignment and deployment readiness gates remain open.

The first Ubuntu run passed install/build/types/lint/format/migration/seed/startup and
2914 server tests, exposing one pre-existing test assumption: JS byte sorting and SQL
collation need not agree for mixed-case course codes. The assertion now checks the exact
fixture projection in database code order, preserving membership/field/order coverage;
no application ordering policy changes. The corrected local full run passes all 2915 server, 2248 client and 10 startup cases,
plus build/types/zero-warning lint/formatting; the corrected full Linux run also passes.
A separate unattended run accumulated multi-minute timing gaps and fixture cleanup failures;
it is not counted as passing evidence. The final full run used an idle-sleep guard scoped
only to that verification command. The collation correction was reviewed by the coordinator;
its requested independent follow-up hit an account usage limit.

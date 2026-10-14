# Development startup

Run commands from the repository root. The development commands use a small
supervisor implemented with Node's built-in modules, so startup does not depend on
`concurrently` being present in an older Docker dependency volume. Existing
workspace dependencies are still required.

## MacBook: Node applications with Docker PostgreSQL

Use Node 20 or newer and start Docker Desktop. For initial setup:

```bash
npm run install:all
cp -n server/.env.example server/.env
cp -n client/.env.example client/.env
docker compose up -d postgres
npm run db:generate --workspace=server
npm exec --workspace=server -- prisma migrate deploy
```

The environment-copy commands preserve existing files. Review the example
configuration for your local database connection. Applying the repository's
reviewed migrations does not reset the database or seed simulated students.
Seeding an empty database is a separate, explicit setup operation; do not reseed
an existing local database just to start the app.

Start both applications:

```bash
npm run dev
```

Open the frontend at `http://localhost:5173`; the backend health endpoint is
`http://localhost:3001/api/health`. Avoid starting a second application instance
on these ports if the existing Docker frontend/backend are already running.

For a single application:

```bash
npm run dev:backend
npm run dev:frontend
```

Every command first completes a shared-package build. Only then does it launch
the shared watcher and the requested server/client watchers. The frontend-only
command retains Vite's `--host` option for Docker access. The server watcher
observes `shared/dist`, so new shared exports trigger server reloads after
compilation.

## Docker development

For a normal future Docker startup or rebuild:

```bash
docker compose up -d --build backend frontend
```

PostgreSQL remains in its named persistent volume. The backend waits for database
health, runs `prisma migrate deploy` to apply existing migrations, and then runs
the shared-build-first backend supervisor. It does not run interactive
`migrate dev`, reset the database, create new migrations, seed students, or start
simulation jobs. The frontend uses its own shared-build-first supervisor and
separate compiled shared-output volume.

Already-created containers retain their original startup command until a normal
Compose recreation applies the updated configuration. Merely editing
`docker-compose.yml` or restarting an existing container does not replace its
stored command. The validation for this change did not recreate or restart the
running app or remove dependency/database volumes.

## Stopping and failures

Press Ctrl-C in the terminal that started development. On macOS and Linux the
supervisor signals each process group, including npm's child watchers. It waits
up to five seconds for graceful shutdown and then forcibly stops any remaining
trees. SIGINT reports status 130; SIGTERM reports 143.

A failed initial shared build prevents all watchers from starting and returns
its failure status. A watcher stopping unexpectedly stops its sibling trees and
fails the overall command, even if that watcher exited with status zero. Spawn
failures also stop the development session. This prevents a partially running
session from being reported as successful.

Windows uses `taskkill /T` for tree cleanup rather than POSIX group signals.
Windows execution has not been validated; the lifecycle tests were run on macOS
and in the existing Linux backend container.

## Verification

```bash
npm run test:development
docker compose config --quiet
```

The startup tests use temporary fixture processes and built-in Node modules. They
do not start real application watchers, bind application ports, read credentials,
or change the database. They cover all three modes, build-before-watch ordering,
failed builds, spawn failures, successful and failed unexpected watcher exits,
interrupting startup, descendant cleanup, forced shutdown and invalid modes.
They also run as part of the root `npm run test` command before the sequential
server and client suites.

On 2026-10-13, all ten startup tests passed both on the Mac host and via
`docker exec -w /app isp-backend npm run test:development`. Compose configuration
validation passed with its pre-existing obsolete-`version` warning. This checks
the supervisor on the existing dependency volume; it does not constitute a
fresh-container startup test.

On 2026-10-14, the ten startup tests, both script syntax checks, selected-file
formatting checks and Compose configuration validation passed again on the Mac
host. The existing backend container was stopped, so that revalidation did not
repeat the Linux container test or start, recreate or restart application
containers.

On 2026-10-15, fresh Linux revalidation was unavailable: the local Docker cache
contained only `postgres:15-alpine`, with no Node 20 or repository backend image.
No image was downloaded and no application container was started, stopped,
recreated or modified. The proposed isolated check would mount only `scripts/`
read-only into a disposable container with networking disabled and run the
built-in lifecycle tests. Those tests create temporary fixture processes; they
do not need workspace dependencies, application ports, credentials or PostgreSQL.
The earlier Linux result above remains historical evidence, not a fresh Linux
validation of the current draft.

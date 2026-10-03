# Shared workspace reload during development

The backend previously watched only server files. Docker built its isolated
shared output once at startup. A new shared export could therefore leave the
backend crashed on a stale type declaration and the browser using an old
optimized CommonJS bundle until a manual rebuild/restart.

The root `dev` command still builds shared first and starts one shared compiler,
server watcher and frontend. The server now watches `src` and `../shared/dist`
with a 500 ms debounce. Generated JavaScript and declarations can restart a
crashed server after compilation.

`dev:backend` and `dev:frontend` each build shared before starting the relevant
application and shared compiler together. Docker Compose and the development
Dockerfile defaults use these commands. Each container retains its own shared
output volume; there is no cross-container compiler race. The existing database
migration command is unchanged in behavior, and no seed/reset is added.

A development-only Vite plugin watches generated shared JavaScript, debounces
emission bursts and restarts Vite with dependency optimization forced. This
rebuilds the browser bundle of the linked CommonJS package. Listener/timer cleanup
allows repeated reloads and clean shutdown. Production builds use no watcher.

Verification used an isolated source snapshot on ports 3039/5199, first with root
`dev`, then with the two separate application commands. A temporary shared export
was checked in a backend route and the served optimized browser dependency. Two
runtime edits propagated automatically in each mode. One interrupt stopped each
test process group and both listeners closed; the source was restored afterward.
Root startup also worked without existing `shared/dist`. Compose configuration
validation passed. Both fresh Docker images built, their default commands started
in disposable containers, and two shared runtime edits propagated to backend and
optimized browser exports automatically. Those containers were removed. The user
app on 5173/3001 was not recreated or stopped.

The new Docker startup commands take effect when development containers are next
recreated. Existing processes keep their original command. Older anonymous dependency
volumes may lack `concurrently`; rebuild and renew only the application volumes when
activating this change:

```bash
docker compose up -d --build --renew-anon-volumes backend frontend
```

This recreates the two application containers and their anonymous dependency/shared
output volumes. It does not remove the named PostgreSQL volume. This activation was
not run against the user's existing app. Prisma schema changes
still require migration/client generation; these watchers address shared code,
not schema deployment. Final review was inline after the earlier agent thread limit.

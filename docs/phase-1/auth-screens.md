# Authentication screens

The browser supports account registration, sign-in, sign-out, and cookie session
recovery after refresh. `/` remains the anonymous demo; `/login` and `/register`
provide the forms; `/curriculum` requires a signed-in account.

The sign-in page also offers **Demo student** and **Demo school admin** buttons
in local development. They create/reuse separate simulated identities and issue
normal httpOnly cookie sessions without passwords. The header shows the real
account role. Both roles currently open the curriculum; the school-admin
dashboard is a future roadmap slice. Demo accounts retain their own browser
selections between visits and do not overwrite registered or seeded accounts.

`GET /api/auth/demo` advertises availability; `POST /api/auth/demo` accepts only
`{ role: "STUDENT" | "ADMIN" }`. Demo login is enabled by default only when
`NODE_ENV=development`. Set `DEMO_LOGIN_ENABLED=false` to disable it locally.
Production and test environments cannot issue demo sessions even if the flag is
enabled. No database migration or seed reset is needed.

The client sends cookies with Axios requests and no longer reads a bearer token
from localStorage. Initial session lookup waits before showing routes. A missing
session leads to sign-in; server/network failures show a retry action. Failed
sign-out keeps the account visible so the student can retry.

Signed-in completed courses, elective claims, and planned courses now persist
through the current-student API. Server hydration overrides the account's browser
cache. Anonymous demo selections remain browser-local. Cache keys are scoped by the authenticated database user ID.
Signing out restores the separate demo selections. Signing in as another account
does not inherit the previous account's selections. Existing demo progress is
preserved without copying it into a new account.

Signed-in curriculum progress uses `/api/users/me/progress`, and clicks use
`/api/users/me/complete`. The map does not fetch a list of students or use the
first demo student's records. Old browser-only account selections are preserved
as a downloadable backup; the additive import API is implemented, and browser
review/import controls remain the next slice. Legacy student,
study-plan, and personalized recommendation reads now require owner/admin access,
and the student directory is admin-only. No new database migration or dependency installation is needed
for browser synchronization.

Vite explicitly bundles the CommonJS output of the linked shared workspace for
development and production, allowing the forms to use the same validation schemas
as the server.

## Local checklist

With the app and PostgreSQL already running, refresh `http://localhost:5173`:

- Open **Create account** and register a new student with a unique email and ID.
  Passwordless seeded demo accounts cannot sign in.
- Confirm the header shows your name and **Sign out**, and the URL is `/curriculum`.
- Refresh and confirm the session remains active.
- Complete an available course, refresh, and confirm your selection remains.
- Sign out and confirm the demo's earlier selections are restored.
- Try an incorrect password and confirm the error appears without leaving the form.
- Sign in correctly and confirm your own selections return.
- Register another account and confirm its selections start empty.
- On **Sign in**, try each demo button, confirm its role in the header, then sign out.

Automated client tests cover these flows, duplicate registration, password byte
limits, session lookup retry, failed sign-out, stale session responses in React
StrictMode, cookie request configuration, and account-specific progress storage.

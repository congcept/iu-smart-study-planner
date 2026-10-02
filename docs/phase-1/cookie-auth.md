# Cookie authentication backend

This slice adds registration and session APIs. The browser now includes
[login/register pages and session recovery](auth-screens.md). Server-backed
browser progress remains the next implementation step.

| Endpoint                  | Successful response                                       |
| ------------------------- | --------------------------------------------------------- |
| `POST /api/auth/register` | 201, `{ success: true, data: { user } }`, session cookie  |
| `POST /api/auth/login`    | 200, same envelope, session cookie                        |
| `POST /api/auth/logout`   | 204, clears the session cookie                            |
| `GET /api/auth/me`        | 200 with the current user, or 401 without a valid session |

Register accepts `studentId`, `name`, `email`, and `password`. Login accepts
`email` and `password`. Email is trimmed and lowercased. Passwords must have at
least eight characters and at most 72 UTF-8 bytes, avoiding bcrypt truncation.
Passwords are stored as bcrypt hashes with cost 10 and are never returned.
Duplicate email/student ID returns 409; invalid input returns 400; bad login
credentials return 401. Registration always creates a STUDENT.

JWTs use HS256 with a fixed issuer/audience and expire according to
`JWT_EXPIRES_IN` (default `7d`; supported units: `s`, `m`, `h`, `d`). The
`isp_session` cookie is httpOnly, SameSite=Lax, path `/`, and Secure in production.
Its lifetime matches the token. No token appears in JSON or localStorage.
Production refuses absent, short, or placeholder signing secrets; set a random
`JWT_SECRET` of at least 32 characters before running in production.

State-changing browser requests must have the configured `CORS_ORIGIN` when
they provide an Origin header. Cross-site Fetch Metadata is rejected when
Origin is absent. Origin-less CLI requests are allowed. This works alongside
SameSite=Lax; frontend Axios requests use `withCredentials: true`.

All existing course, user, and study-plan mutations require a session. Catalog
changes and legacy user creation require ADMIN. Students can only mutate their
own records and study plans. Nested semester routes verify that the semester
belongs to the specified plan. The current database role is checked on every
authenticated request, so role changes take effect immediately.

Legacy read-only demo routes remain public for compatibility with the current
demo curriculum screen. They must move behind account access when server-backed
progress is connected. Password and password-hash fields are excluded from
user responses now. Legacy passwordless demo students are preserved; they cannot
log in. Register a new account to test authentication.

## Local setup

The migration only adds nullable `password_hash` and STUDENT-default `role`.
The previously ignored migration history is now tracked so a fresh checkout can
create the existing tables before applying the authentication migration.
The unused legacy `password` column stays temporarily for compatibility; neither
authentication nor registration reads or writes it.

From the repository root:

```bash
npm run install:all
npm run build --workspace=shared
npm exec --workspace=server -- prisma migrate deploy
npm run db:generate --workspace=server
```

If the app runs in Docker, refresh its separate backend dependency volume and
Prisma client, then restart only the backend:

```bash
docker exec -w /app isp-backend npm install --workspace=server
docker exec -w /app isp-backend npm run db:generate --workspace=server
docker restart isp-backend
```

## Testing

PostgreSQL must be running. The tests use isolated fixtures and clean up afterward:

```bash
npm run test --workspace=server -- --runInBand
```

Coverage includes register/login/logout/me, duplicate identities, password
validation and hashing, cookie attributes, invalid and expired sessions,
deleted accounts, origin checks, admin guards, student isolation, and nested
semester ownership. Existing prerequisite/cascade tests now use authenticated
student sessions. Public curriculum rendering and browser-local progress are
unchanged by this backend slice.

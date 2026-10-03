# Curriculum identity in cookie sessions

Register, login, `/auth/me` and development demo replies now include the stored
`curriculumId`, explicitly null when no assignment exists. The shared auth projection
supplies the same field across flows; the login projection continues to exclude the
password hash. Authentication reads the current user, role and context from the database
on each request. Context is not trusted from a JWT claim or a client body.

Auth request schemas still reject curriculum assignment fields. This increment exposes
identity only; it does not add assignment, switching, a selector or client rendering.
Deleting a fixture curriculum follows the existing foreign-key policy and returns null
on the next session read. Demo login preserves an existing demo identity and assignment.

`AuthUserDTO.curriculumId` is optional for compatibility with older cached sessions and
existing client fixtures. Current server replies always include it. Future context-aware
client code must distinguish an omitted field from confirmed null; an old cache cannot
establish the active account's scope. Server hydration remains authoritative.

Eight PostgreSQL regressions cover auth reply consistency, unassigned nulls, rejected
assignment inputs, same-token freshness, context deletion, role/account isolation, invalid
sessions, demo preservation and password privacy. Existing auth/demo regressions and an
independent review cover the affected flows.

The review identified an older identifier inconsistency, now fixed separately: owner access
guards normalize UUID casing before checking ownership and before downstream database reads.
Student-ID aliases remain case-sensitive, UUID-shaped aliases retain primary-key precedence,
and direct user-ID routes still do not accept student aliases. Eleven PostgreSQL cases plus
auth/access coverage verify the fix (36 focused cases); independent review found no blocker.

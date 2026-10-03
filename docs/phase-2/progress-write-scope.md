# Completion and import scope preconditions

The cookie-account completion and archived-progress import endpoints accept an optional strict
`expectedScope: { userId, curriculumId }`. UUIDs normalize; curriculum is an explicit UUID or
null. This extends the grade-write contract and never assigns an account or curriculum.

Inside each existing Serializable write transaction, `assertProgressWriteScope` compares the
precondition with the loaded database owner/context before membership, prerequisites, elective
claims, cascades or writes. A mismatch returns 409 even if the course is shared across curricula
or the import would otherwise be a no-op. Completion removes the precondition before passing
record fields to Prisma. It is never persisted on student records. Scope-less legacy API clients
remain compatible; assigned account editing and assignment stay gated.

Existing mandatory prerequisite handling, context-specific edges, additive imports, metadata
preservation, cycle validation and bounded transaction retries continue unchanged. Grades and
ratings remain independent of completion, including rejected or valid cascades.

## Verification

Build, typecheck, zero-warning lint, 769 server tests and 482 client tests pass on the exact
isolated source. The 31 added real PostgreSQL cases cover assigned/unassigned matching scopes,
each stale UUID/null transition, wrong cookie ownership, uppercase identities, shared courses,
malformed claims, COMPLETED/PLANNED/DROPPED, preserved historical metadata and grade/rating rows,
valid mandatory cascades, no-op imports and concurrent scoped import/uncompletion.

This increment changes the server contract only. The current progress store does not yet retain
an authoritative context in its cache. Next add validated cookie-owner/context snapshots and
connect the confirmed precondition before enabling assigned curriculum editing. Rating writes
still need the same guard. No migration, selector, assignment, reseed or degree-completion claim
is included. Final review is inline because the requested workers reached an account usage limit.

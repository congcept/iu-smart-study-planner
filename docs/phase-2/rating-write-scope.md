# Rating write scope preconditions

`POST /api/courses/:id/rate` accepts optional `expectedScope: {userId, curriculumId}`.
The nested schema is strict; UUIDs normalize to lowercase, and `curriculumId` must be an
explicit UUID or null. This binds the reviewed account context; it cannot assign a major
or choose the authenticated owner. Legacy requests without scope retain existing behavior.

The service validates direct callers too. Within the Serializable transaction, it locks and
reads the current database owner, then checks scope before course/completion validation,
existing-vote handling, quota consumption, vote writes, cached aggregates and the returned
estimate. Mismatch returns 409, including unchanged-vote retries. Historical completed
nonmember courses remain globally rateable with their CURRENT confirmed scope. Context
members still receive their curriculum prior. No vote or completion history is rewritten.

The deterministic context-switch test exposed Prisma wrapping a raw-query PostgreSQL
serialization failure as `P2010` with `meta.code: '40001'`. The bounded five-attempt loop
now retries that specific condition as well as `P2034`, opens a fresh transaction and
rechecks scope. Other database/validation/quota/scope errors propagate normally.

Validation includes 24 real-PostgreSQL cases for null/assigned transitions, edited and
identical retries at quota limits, owner spoofing, strict validation, uppercase UUIDs,
legacy compatibility, preserved global history and a deterministic owner-row lock race.
Fifteen adapter cases prove normalization/forwarding and pre-POST malformed-scope rejection.
Independent review found no blocking issue. Full build/types/zero-warning lint and regression
gates are recorded in AGENTS.md.

This increment supplies the server contract and validates existing adapter forwarding.
The Ratings screen still sends legacy scope-less votes; private scoped rating snapshots,
contextual course hydration and durable UI retry binding are the next increments. No selector,
assignment, schema migration, seed or production data change is enabled here.

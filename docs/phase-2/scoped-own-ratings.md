# Owner-bearing personal rating snapshots

The protected `GET /api/users/me/ratings/snapshot` returns
`{scope: {userId, curriculumId}, ratings: [{courseId, rating}]}` in the normal API envelope.
It rejects query overrides. The owner/context and all personal votes are read together in
one RepeatableRead transaction. A missing owner never becomes a verified empty snapshot.
The existing `/me/ratings` array endpoint remains unchanged.

Votes remain global history. A curriculum switch, empty assigned context or course
uncompletion does not remove them. The current context identifies the account snapshot;
it does not attribute historical votes to that curriculum or assert completion eligibility.
Only course identities and personal integer ratings are returned; no other owner's votes,
password fields, database timestamps, curriculum metadata or private user details are exposed.

The shared strict schema normalizes owner/context/course UUIDs, permits explicit null context,
validates integer votes 1–5 and rejects duplicate course identities including case variants.
`getScopedOwnRatings(expectedUserId)` validates its expected owner before the private GET,
then validates the envelope, snapshot and returned owner. Legacy arrays or expanded responses
cannot silently activate the new contract. Vote order is deterministic; empty history is valid.

Sixteen new real-PostgreSQL cases and thirty-two adapter cases cover cookie owner/role access,
query rejection, unchanged database state, historical votes, null/empty context, strict response
validation and consistent snapshots across concurrent context/vote updates. Independent source
review found no blocking issue. Full build/types/lint/regression totals are recorded in AGENTS.md.

The adapter is available for client integration. Ratings screen activation requires a consistent
course-choice/eligibility reader with contextual priors and durable retry scope binding first.
Assigned editing, selectors, assignment APIs, schema migration and seed changes remain gated.

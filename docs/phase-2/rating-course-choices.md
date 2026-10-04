# Completed courses for private rating entry

`GET /api/users/me/ratings/courses` returns a strict owner/context scope and a minimal
list of the account's currently completed courses. Completion, current membership,
personal votes, cached vote evidence and Bayesian priors share one RepeatableRead
snapshot. Query overrides are rejected; a missing owner never becomes an empty success.

Each unique course includes its code/name, aggregate rating evidence, estimate/prior,
personal vote and membership classification. Physical training and unplaced members
remain eligible. Planned records, numeric attempts and historical votes alone do not
establish completion. Repeated curriculum placements never duplicate a choice.

Current members use the full curriculum's prior. Completed nonmembers remain eligible
history and use the global prior; they are labeled `OTHER_HISTORY`. Unassigned choices
use global priors and `UNASSIGNED`. An empty assigned context retains its identity and
never masquerades as an unassigned account. Empty eligible lists skip unnecessary prior
reads. Votes remain global; membership does not attribute past votes to a curriculum.

`getRatingCourseChoices(expectedUserId)` validates the private response before returning
it. Shared validation normalizes UUIDs and rejects legacy/expanded responses, duplicate
identities/codes, invalid vote evidence and mismatched membership/prior sources. The
server still rechecks completion and expected write scope when a vote is submitted.

Twenty-one real-PostgreSQL cases and sixty-seven adapter cases cover eligibility,
privacy, contextual priors, preserved history, empty contexts, strict responses and
consistent reads through concurrent committed updates. Independent review found no
blocking issue. Full verification totals are maintained in AGENTS.md.

The reader and adapter are available. Ratings screen adoption and durable write/retry
scope binding are the next increment. No assignment, selector, seed, schema migration,
course history or vote write is introduced by this read endpoint.

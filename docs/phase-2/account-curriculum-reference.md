# Assigned account curriculum reference

The protected My curriculum route now resolves a fresh cookie session before mounting the
existing map. Only explicit null context mounts the legacy editable CS map. Assigned accounts
read their public curriculum reference through a strict shared/API contract and confirm the
session again before publishing it. Missing/invalid context, another owner, a different returned
reference or a context change during the read fails closed with retry. Refresh on focus or
visible-tab changes withholds old data; generation and owner guards reject stale callbacks,
including an A-B-A owner round trip. Anonymous demo routing is unchanged.

Assigned references show course identities once, with every repeated curriculum placement,
elective group/select count, context-only prerequisites and mandatory policy, Bayesian
difficulty with actual global vote counts and contextual prior copy, and unresolved free
requirements without inventing course identities. Nonfork curricula explicitly have no GPA
thesis path. The view is read-only: no completion mutations, old CS percentage/target, manual
GPA choice or global placement/category/prerequisite fallback. Reference semesters do not
certify class offerings. No major selector or account-assignment endpoint is enabled.

The contract validates metadata and HTTP source URLs, duplicate identifiers, member endpoints
for prerequisite edges, mandatory policy, rating confidence and a shared context prior.
The existing semester preview reuses the same course shape. Three PostgreSQL cases validate
real responses for two different contexts and an empty one. Seventeen API cases and seventeen
component cases cover boundaries, races, recovery, old-account callbacks, repeated electives,
prerequisites, empty references and unresolved requirements. Existing auth fixtures now include
explicit null metadata and account for the extra protected-route session read.

Build, types, zero-warning lint, 717 server tests and 432 client tests pass on an isolated owned
source snapshot. Browser checks at 1440 × 1000 and 390 × 844 used a disposable simulated account
and one-course nonfork reference. The correct member placement, real rating confidence and
nonfork copy appeared with no horizontal overflow and a 44-pixel reload control. Read-only
inspection preserved all numeric attempts and legacy records; temporary fixtures/listeners
were removed. Review was inline after the account usage limit prevented further subagent
review. Existing local UI drafts were excluded from the snapshot and commit.

Next: consume contextual progress/history summaries in this reference view. Context-aware
completion mutations, import/claim transfer, pending requests and cache invalidation need
validation before assignment. A fresh session check cannot provide atomic preconditions for
an account/context change after that read. Signed IT/DS reconciliation, full-degree rules,
required school-admin allocation and deployment/thesis gates remain outstanding.

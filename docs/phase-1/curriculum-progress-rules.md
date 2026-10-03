# Account-context progress rules

The cookie owner's stored `curriculumId`, when present, now controls completion, import and
cascade rules. Accounts without an assignment retain the legacy global prerequisite behavior.
No assignment endpoint, automatic migration or major selector is introduced.

All changed courses must be members with at least one context placement. New completion claims
must match a placement: null is allowed for a required appearance; an elective-only course
requires one of its context groups. Repeated group appearances remain valid. Omitting a claim
on an existing completion retains and validates its stored claim. Planning/uncompletion clears
the claim and does not require a new choice. Nonmember or unplaced changes return 409 atomically.

Completion and import use only the assigned context prerequisites, with every edge mandatory
regardless of preserved legacy flags. Import can atomically satisfy a reversed chain, rejects
new cycles and invalid claims, and preserves existing completion metadata over ignored archive
values. Uncompletion follows only the context's transitive dependent edges. Serializable retries
keep imports/completions valid when they race with uncompletion. Legacy mutation routes use the
same service; cookie ownership and strict input guards remain intact.

`GET /api/users/me/progress` and mutation snapshots filter to context member identities in a
consistent transaction. Nonmember historical records stay in the database. Claims are not
silently remapped, and immutable numeric attempts/global votes survive completion cascades.

Twenty-two real PostgreSQL API cases cover two curricula sharing courses with different edges,
cookie-owner isolation, repeated claims, missing membership/placement, imports, cycles,
cascades, history preservation, uncompletion races and unassigned-account compatibility.
Shared-first build/typecheck, zero-warning lint, 530 server tests and 310 client tests pass
for the isolated snapshot. Final review was inline after the earlier agent thread limit.

Only simulated test accounts are assigned. Before exposing assignment, grade summaries,
recommendations, workload/semester planning and client hydration must agree on context.
Switching must explicitly validate existing completions/claims against the new context rather
than blindly changing a user field. Legacy profile/record projections still need contextual
read treatment. Signed source/cohort and graduation-total reconciliation remains outstanding.

# Context-scoped grades with preserved history

For an assigned account, numeric GPA and ungraded-completion coverage use only curriculum
member course identities. Immutable attempts remain visible in full, including courses outside
the current context. Highest retakes, credit weighting, exact decimal `>70` comparison, PT and
zero-credit exclusions, and preservation of legacy letters remain unchanged. A context with
`isGpaPath: false` has a null thesis/alternative path even when its numeric GPA is known.

New numeric grade entries require placed membership in the owner's stored curriculum. Entry
is independent of completion status, allowing failed/zero scores without completing a course.
Unassigned accounts retain existing global-course behavior. The eligibility check and immutable
upsert share a Serializable transaction with bounded retries for serialization/uniqueness races.

An existing identical account/request key is recovered before checking current membership.
This preserves a committed attempt after a context change; changed payloads still return 409,
and a new request for a nonmember/unplaced course returns 409 without a write. GPA/history,
coverage and the context GPA-fork flag are read in one RepeatableRead snapshot.

Fifteen PostgreSQL cases cover historical nonmembers, highest retakes, exact 70, a nonfork
curriculum, gaps, PT/zero exclusions, entry guards, cookie isolation, context-change recovery,
snapshot consistency, eight concurrent retries and legacy compatibility. The focused new and
existing grade API/storage suites pass 80 cases. Full verification is 545 server / 310 client
tests with shared-first build, typecheck and zero-warning lint. Review is inline after the prior
agent thread limit.

One initial full run saw an existing workload HTTP test fail because its response had no data.
The focused workload suite and full diagnostic server rerun passed without a source change;
the cause remains unconfirmed and is retained as a stabilization finding.

Assignment remains unavailable. Recommendation/workload/semester planning must adopt the same
context evidence and GPA-fork flag next. The client must then show the summary's context scope,
retain full history transparently, handle nonfork curricula and isolate hydration/pending
handlers by account and context before a selector or transfer can be enabled.

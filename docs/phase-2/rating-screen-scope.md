# Ratings screen context and recovery

The Ratings screen now hydrates from the strict completed-course choices endpoint.
Eligibility, metadata, personal votes and difficulty priors arrive with one owner/context
scope. Current members display curriculum estimates; completed historical nonmembers
are identified and retain global estimates. The old independent catalog/progress/vote
read combination is removed.

New saves persist the confirmed scope with the exact course/rating before POST. Retries
reuse that original scope. A changed context, missing completion, wrong-owner journal,
scope-less legacy journal or corrupt storage never silently rebinds a request. Context
changes clear active choices. Pending data remains available for explicit local clearing;
the interface explains that an earlier server save may already exist.

POST data alone never confirms a save or updates estimates. The scoped all-history vote
reader must confirm both original scope and desired vote before the journal is retired.
The same read can recover a lost response. “Check saved rating” performs only this read,
including after remount or course uncompletion; it never replays the write. Absent or
different evidence leaves the request pending. Failed confirmation clears write proof
and requires fresh validated choices. Successful confirmation refreshes all estimates;
failed refresh blocks another save.

Saving remains locked through confirmation. Focus/visibility refresh skips active writes,
and account/load generations isolate late responses, including account A → B → A.
Storage removal must succeed before releasing recovery data. Explicit clearing only
removes this tab's journal, then hydrates current choices; it never alters a server vote.

The migrated fifteen form cases and twenty-eight scope cases cover these boundaries.
Independent review's confirmation-proof and storage-recovery gaps were repaired and
regression-covered. An isolated real-browser check saved one vote, rejected a stale
context update without changing it, and explicitly cleared the local retry to load the
current curriculum estimate. Desktop and 390px mobile views showed no horizontal
overflow. Disposable fixtures, listeners, tab and viewport override were cleaned up.
Full build/types/lint/regression totals are recorded in AGENTS.md.

Curriculum assignment, selectors, verified curriculum publication and assigned completion
editing remain gated. Ratings stay global votes; the scope protects request intent and
chooses estimates, rather than attributing historical votes to a curriculum.

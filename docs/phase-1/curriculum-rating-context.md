# Curriculum-consistent rating replies

Public `GET /api/courses/:id/ratings?curriculumId=<uuid>` now resolves the requested curriculum
prior while retaining the course's global average, distribution and vote count. Context UUIDs
are validated and normalized; absent/empty contexts or nonmember courses return 404. Reads
without a context retain the global prior and the original single-argument service signature.

After a completed-course vote, a signed-in member receives the stored account curriculum's
prior and estimate in the same Serializable transaction as the vote and durable quota.
Query/body values cannot choose another student's context. Identical votes still preserve row
identity/timestamps and consume no extra write. Historical completed nonmember courses remain
globally rateable and receive a global summary; no historical vote is deleted or reassigned.

The context prior resolver is shared with curriculum detail reads, so vote replies, scoped
rating reads and detail cards agree. Global cached aggregates remain shared across curricula.
The shared prior-source union explicitly distinguishes global/context ratings and seed means.

Fourteen PostgreSQL cases cover context seed/rated means, global evidence, matching replies,
cookie ownership, historical votes, safe retries, global compatibility, UUIDs, membership and
concurrency. New rating cases and existing rating API/context reads pass 66 focused cases.
Shared-first build/typecheck, zero-warning lint and all 559 server / 310 client tests pass
for the isolated snapshot. Review remains inline after the earlier agent thread limit.

The running Docker app's isolated shared output and Prisma client were regenerated, and its
backend watcher reloaded. HTTP checks return 200 for frontend 5173, backend health, legacy
curriculum, context detail and global/context rating reads. No database reset/seed was used.

Next adopt context identities, prerequisite edges, priors and GPA-fork policy in personalized
recommendations and workload/semester planning. Do not infer requirement-category grade fit
from global legacy category labels. Assignment/selector activation remains gated on remaining
server readers, client context isolation, transfer validation and signed IT/DS reconciliation.

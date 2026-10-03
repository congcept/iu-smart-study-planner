# Account-scoped workload analysis

`POST /api/recommendations/analyze-workload` accepts a strict `{ courseIds }` body.
UUIDs are normalized, and repeated IDs count once. Unknown courses reject the
whole request with 404 instead of silently lowering the workload total.

With no session, the anonymous demo uses the global catalog and global rating
prior. A supplied cookie must authenticate successfully; invalid, empty and
deleted-account sessions return 401 rather than becoming anonymous. A signed-in
unassigned account retains global behavior.

For an assigned account, the account's stored `curriculumId`, selected placed
members, global cached vote evidence, and curriculum-wide prior are read in one
RepeatableRead transaction. A nonmember, unplaced member, or missing course rejects
the whole selection with 409. Empty assigned contexts never fall back to the
global catalog. Body/query values cannot select a different owner or context.

The prior matches curriculum detail: votes on unique member courses from any
student, or the mean seed difficulty of unique members when there are no votes.
It is not a mean of the requested selection and repeated placements do not weight
it. Course votes remain global. Credits include all selected courses, including
physical training; the earned-credit exclusion does not apply to planned workload.

The response preserves numeric credits, rounded difficulty, heuristic score, risk
band and workload advice. Its additive `scope` identifies the curriculum, prior
mean/source and whether category balance is available. Context category advice is
disabled until requirement metadata is verified; global categories must not be
presented as confirmed curriculum attributes. Guest/unassigned category advice
retains its existing behavior.

This does not validate prerequisites, timetable conflicts, teaching resources or
personal study time. It does not save suggestions, assign accounts, or enable a
major selector. Recommendations, semester planning, saved-plan projections and
client context hydration are separate follow-up increments.

Seventeen new real-PostgreSQL cases cover membership, account isolation, prior
consistency, global vote evidence, duplicates, session failure, category neutrality
and owner/context spoofing. Together with existing workload cases, all 32 focused
tests pass. Final review was inline after the earlier agent thread limit.

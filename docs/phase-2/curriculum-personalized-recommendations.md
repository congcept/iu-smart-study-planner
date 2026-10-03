# Curriculum-specific personalized recommendations

`GET /api/recommendations/user/:userId` continues to require owner or administrator
cookie access. The requested user's stored curriculum determines the context;
query parameters cannot choose another owner, curriculum or GPA path. A missing
requested owner now returns 404 instead of global fallback recommendations.

For assigned users, curriculum detail, its unique member courses and rating prior,
the user's records and numeric attempts are read in one RepeatableRead snapshot.
Only courses with placements surviving the curriculum's GPA policy are candidates.
Every context prerequisite is mandatory regardless of legacy strict/corequisite
flags. Global prerequisite edges and other curricula's parents never unlock or
block a candidate. Completed/in-progress courses are omitted; planned courses
remain eligible for read-only suggestions.

The GPA calculation uses only member scores, highest retakes, credit weights,
physical-training/zero-credit exclusions and exact decimal comparison with 70.
Nonfork contexts report a null path. A fork with no eligible numeric grades retains
both choices. Placement filtering happens before availability counts, unlock
scoring and credit budgeting: an opposite final-semester occurrence is omitted,
while an earlier occurrence of that same elective remains. Multiple appearances
count as one global course. Unlock bonuses ignore excluded/unplaced dependents.

Ranking retains context prerequisite-unlock counts, projected rating difficulty,
credit limits and existing workload constraints. Global requirement categories
are not verified context metadata, so context responses omit them and numeric
category grade fit remains neutral. The response uses `CurriculumCourseDTO` with
actual surviving placements, global cached vote counts/averages and contextual
estimates. It omits legacy flat category/placement/group fields and internal edges.
Additive scope reports the reference context, prior and unavailable category
personalization. It does not expose private records or grade attempts.

Unassigned accounts retain the legacy response/catalog and existing numeric grade
fit. No assignments, selector or saves are activated by this increment. The client
recommendation types/renderer still require context hydration and scope handling
before assignment is exposed. This is a shortlist, not an elective-requirement,
timetable, resource-capacity or graduation validation.

Twenty pure policy tests and fourteen real-PostgreSQL API cases cover the GPA
boundary, retakes, member scope, nonfork behavior, repeated/earlier placements,
mandatory and conflicting parents, rating evidence, neutral categories, ownership,
filters and no fallback. These and legacy GPA/workload cases pass 61 focused tests.
Final review was inline after the earlier agent thread limit.

# Server GPA path

Grade GET/POST summaries now include `gpaPath`: THESIS for GPA above 70, ALTERNATIVE at
or below70, null without scored eligible credits. The policy uses highest 0–100 course
scores weighted by credits and excludes PT001IU/PT002IU and zero-credit courses.
Legacy letters remain untouched. Decimal arithmetic compares weighted totals directly
to70 times credits, avoiding floating-point drift at exact70; display remains numeric.

Fifteen added cases cover boundary scores, true near-boundary values, exact weighted
decimals, retakes, weighted eligibility, excluded courses and cookie-account API access.
Build/typecheck/lint and 367 server/234 client tests pass. Subagent review identified the
binary precision bug and prompted the correction. Client Y4S2 remains manual until the
next increment; school eligibility rules beyond the confirmed threshold are not inferred.

## Curriculum rendering

Signed-in curriculum rendering uses `summary.gpaPath` for the Y4S2 courses,
recommendations and progress target. It never re-derives eligibility from the rounded
transport GPA. Guests and a validated explicit-null summary retain manual controls.
Invalid or failed summaries block course editing and show retry. The account owner and
request generation guard stale responses, and focus/visibility refresh picks up grade
changes while retaining completed/planned progress.

31 hook and eight map integration tests cover numeric/server path agreement, exact and
rounded 70, no-score manual mode, retries, stale accounts, refresh and preserved progress.
Full build/typecheck/lint, 367 server and 234 client tests pass. Browser checks at desktop
and 390px confirm the 84.29 Thesis path and no horizontal page overflow.

## Personalized recommendation path

The server recommendation route now applies the exact grade-summary path before
availability counts, semester filtering, ranking and credit budgeting. Only courses
whose stored earliest placement is Year 4 Semester 2 are affected: Thesis for THESIS,
other courses for ALTERNATIVE. Earlier duplicate elective placements remain eligible;
using the overwritten electiveGroup alone would incorrectly remove them. Null numeric
GPA retains both options because no manual server choice is persisted. Query parameters
cannot override a numeric path. Statistics expose gpaPath through a shared DTO.

This is current CS placement policy. Curriculum context must replace that assumption
before IT/DS support. Twelve placement and 14 PostgreSQL route cases cover decimal
boundaries, highest retakes, exclusions, budget refill, prerequisites and account/admin
isolation. Build/typecheck/zero-warning lint and 427 server/234 client tests pass.

# Server GPA path

Grade GET/POST summaries now include `gpaPath`: THESIS for GPA above70, ALTERNATIVE at
or below70, null without scored eligible credits. The policy uses highest 0–100 course
scores weighted by credits and excludes PT001IU/PT002IU and zero-credit courses.
Legacy letters remain untouched. Decimal arithmetic compares weighted totals directly
to70 times credits, avoiding floating-point drift at exact70; display remains numeric.

Fourteen added cases cover boundary scores, true near-boundary values, exact weighted
decimals, retakes, weighted eligibility, excluded courses and cookie-account API access.
Build/typecheck/lint and366 server/195 client tests pass. Subagent review identified the
binary precision bug and prompted the correction. Client Y4S2 remains manual until the
next increment; school eligibility rules beyond the confirmed threshold are not inferred.

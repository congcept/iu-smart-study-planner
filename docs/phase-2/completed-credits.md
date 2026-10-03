# Completed-credit totals

Profile `stats.totalCredits` and degree-progress completed credits now share the rule
that PT001IU and PT002IU contribute zero earned degree credits. Their records and
completed-course counts remain present. The progress denominator uses the same rule.

Semester plans still include physical-training credits for workload planning. No data
migration, reseed, or change to completion status is needed. Five PostgreSQL regressions
cover profile lookup by UUID/student ID/admin, progress totals, and planned credits.

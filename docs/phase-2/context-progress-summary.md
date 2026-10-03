# Read-only contextual progress summary

Assigned My curriculum references now display saved current-member completion, earned
credits, planned and in-progress counts. Physical training remains required but contributes
zero earned credits. Historical records outside the curriculum keep their names, statuses
and elective claims in a separate list; they do not contribute to current totals. No
percentage, remaining-degree total, mutation, assignment or selector is enabled.

The existing protected user progress endpoint exposes its actual owner in contextual scope
from the same repeatable-read snapshot. A strict shared schema validates owner/course
identity, record uniqueness, status buckets, contextual difficulty/count/prior metadata and
completed count/earned-credit consistency. It preserves legacy grade metadata without numeric
conversion. The adapter accepts only the expected owner and curriculum; explicit owner route
reads retain server ownership/role authorization. Old global replies cannot supply scoped
progress. Empty references are valid without an invented prior or degree percentage.

The summary remounts on owner/context boundaries. Loading/retry clears old results, bounded
request guards ignore late/unmounted replies, and parent focus/visibility refresh remounts
it after rechecking the session. The read-only reference remains available when the private
summary fails; its alert does not claim saved progress is empty.

Four new PostgreSQL cases validate actual scope contracts for two contexts, an empty context,
and member/PT/historical records. Nineteen API and ten component cases cover invalid scopes,
legacy replies, physical-training totals, malformed records, retry, historical claims and
owner/context changes. Build, types, zero-warning lint, 721 server tests and 461 client tests
pass on the exact isolated source snapshot. Desktop/mobile checks at 1440 × 1000 and
390 × 844 used a disposable simulated reference/account: one current completed course earned
4 credits, an outside-context thesis record remained separate, reload controls were 44 pixels,
and neither viewport overflowed horizontally. Read-only inspection preserved all grade
attempts and legacy records; temporary fixtures/listeners were removed. Review was inline
after the account usage limit prevented further subagent review.

Next: show current member statuses on read-only reference cards. Context-aware completion
editing, pending mutation preconditions, import/claim transfer and cache isolation remain
required before assignment. Context/source read snapshots do not provide atomic preconditions
for later writes. Signed IT/DS reconciliation, verified degree/elective rules, required
school-admin allocation and deployment/thesis gates remain outstanding.

# Current-curriculum grade course picker

`GET /api/users/me/grades/courses` resolves the cookie owner and stored curriculum in one
repeatable-read snapshot. Assigned accounts receive only global course identities with a
placement in that curriculum; unassigned accounts retain the basic global course list.
The response exposes strict owner/context/fork scope plus id/code/name, without global
category, placement or prerequisite fallbacks. Query claims cannot override owner/context.
Choices indicate grade-entry membership, not prerequisite eligibility or course offerings.

The adapter validates the strict shared response, duplicate identities/codes and expected
owner. Grade entry disables new submissions while choices are loading, unavailable or empty.
Focus/visibility refresh withholds old choices and clears an obsolete draft selection;
request generations prevent older reads or an unmounted account from restoring choices.
The current-choice check runs before creating a new immutable request. Historical attempts
stay in history. A pending request outside the new choices retains its exact key and can
recover a previously committed append; an unconfirmed request remains locked for exact-key
retry, where the server enforces current membership. A mismatched scoped history owner
cannot clear the pending journal or reconcile the dashboard.

Eight new PostgreSQL cases cover member placements, basic projections, unassigned choices,
other/empty/changed contexts, unchanged histories and authentication/query guards. Eight
API and eight entry cases cover strict validation, focus races, empty choices and immutable
recovery. Build, types, zero-warning lint, 714 server tests and 398 client tests pass on the
exact isolated source snapshot. Browser checks at 1440 × 1000 and 390 × 844 used a disposable
simulated account assigned to a one-course nonfork reference. Only MA001IU was offered;
all three historical attempts remained visible with GPA 90. Form controls were 44 pixels
high and neither viewport had horizontal page overflow. Read-only review preserved the
numeric attempts and legacy records; the temporary fixtures and listeners were removed.
Review was inline because the account usage limit prevented further subagent review.

Account assignment and the major selector remain gated. Curriculum map/progress/cache
adoption and transferred selections need contextual validation. The current picker does
not provide atomic expected-owner/context preconditions across a later account change,
certify full-degree eligibility or reconcile signed IT/DS sources.

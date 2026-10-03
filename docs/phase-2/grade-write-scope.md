# Grade write scope preconditions

A score chosen under one account or curriculum must not become a new attempt under another
cookie account or stored curriculum. Global course membership alone cannot detect the change:
the same course can be placed in both curricula.

## Behavior

`AppendGradeAttemptSchema` accepts an optional strict `expectedScope: { userId, curriculumId }`.
UUIDs normalize to lowercase; curriculum is an explicit UUID or null. The cookie still determines
the owner and the database still determines curriculum. Neither field can assign an account or
curriculum. Existing scope-less API clients remain compatible during this additive transition.

The current grade-entry form always captures the confirmed picker scope in a new durable request.
It keeps the same scope, course, score, term and request key on retry. The API adapter requires a
matching scoped response owner for these writes. An owner mismatch rejects with 409 before
request lookup. Inside the Serializable append transaction, a new request compares the stored
curriculum with the expected one before placement validation or insertion. Curriculum mismatch
returns 409 even if the course belongs to both contexts. Completion and legacy metadata stay
independent of numeric attempts.

An exact already committed request recovers before the curriculum comparison. Its full history
remains immutable and the returned summary follows current context. Changed score/term/course
under the same key still rejects. Scope is a precondition only and is never stored in an attempt.

Recovery keeps an absent stale-context journal locked, refreshes course choices, and offers saved
history reload without reassigning the pending request. An older scope-less journal can recover
an existing attempt but cannot create a new attempt through the current form if history is absent.
The journal remains intact. A safe explicit resolution flow for these absent legacy journals is
still pending; assignment/selector stays gated until recovery and store context isolation land.

## Verification

Build, typecheck, zero-warning lint and all 738 server / 482 client tests pass on an isolated
snapshot excluding unrelated local interface drafts. Added coverage: 17 real PostgreSQL cases,
4 API-adapter cases, 8 form cases. Cases include each UUID/null context transition, a shared course,
wrong cookie ownership including a colliding request key, UUID casing, malformed nested claims,
concurrent identical retries, immutable recovery after context change, fresh picker preconditions,
missing response scope, locked older journals and late/account response isolation regressions.

An isolated browser workflow uses a disposable simulated account, not real student data: a score
of 81 saves once, the prior 90 remains the highest retake, and a second score of 82 after changing
the stored curriculum is rejected. Existing numeric attempts and every legacy record field remain
unchanged. Desktop/mobile review checks the recovery copy and form bounds. Test account and
reference curriculum are removed after review; the running user app and PostgreSQL remain up.

Final review is inline. The previously requested subagents hit the account usage limit, so this
increment must not be described as independently reviewed.

## Next

Apply expected scope checks to completion/import and ratings, then make store hydration/cache
and optimistic mutation generations curriculum-aware before enabling context editing or assignment.
Full degree totals, IT/DS source reconciliation, the selector and required school-admin allocation
remain incomplete.

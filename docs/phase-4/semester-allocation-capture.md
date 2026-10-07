# Explicit semester simulation capture

`POST /api/admin/semester-allocation-runs` requires current cookie ADMIN access and a strict
`curriculumId`, `semester`, numeric `year`, `requestId` and `expectedActorId`. Extra query/body
fields reject. Callers cannot upload participants, choices, scores, credit targets or results.
The server reads the semester producer and stores its complete pinned V1 replay plus every
participant outcome in the same Serializable transaction. It returns 201 for a new capture
and 200 for exact actor/scenario retry recovery; both replies contain only the aggregate.

Current ADMIN authorization is held FOR SHARE through commit. The expected account is checked
before looking up the account-scoped retry key. A previously committed key recovers its verified
historical result before current configuration, cohort, curriculum inputs or capture clocks are
consulted. A key belonging to another scope rejects with 409. An unconfirmed save must retain its
exact key; no transport fallback starts a different capture. New source reads and both storage
writes roll back together. Participant role and assigned curriculum links are checked FOR SHARE
before committing; source/account writers serialize or cause bounded transaction retries.

At most five attempts retry serialization/deadlock or unique-key races; exhausted retries and
FK conflicts report 409. Each attempt has a three-second acquisition wait and fifteen-second
transaction timeout. Other failures report an unconfirmed save without a new key. The existing
500-student / 100-choices-per-student / 10,000-total-choice bounds remain, and raw history length
is not bounded. These limits do not guarantee completion within the transaction budget.

`GET /api/admin/semester-allocation-runs/:id` requires fresh ADMIN access and returns a verified
aggregate historical capture. `GET /api/users/me/semester-allocation-runs/:id` requires a current
account and the live participant access FK, then returns only that participant's outcome and
assigned course credits. Both reject malformed IDs, extra queries and nonempty bodies. No owner
ID is accepted. Nonparticipants and missing runs receive the same 404. A historical participant
who later changes role or curriculum retains their own read; deleting the account nulls the link
and revokes access even if an account with the same UUID is recreated. Retained captured UUIDs
remain private historical data; this is access revocation, not erasure or anonymization.

Pinned V1 replay and complete bounded participant validation fail closed on corrupt, missing or
inconsistent history. Aggregate replies omit participant identities, private candidates, scores,
assignment traces, retry keys and author metadata. Owner replies omit every other participant
and their own retained captured UUID. Existing one-course V1 captures/jobs remain separate.

All outcomes remain simulation references. No student progress, grades, ratings, study plans,
resources or official registrations change. All academic/timetable/allocation validation flags
remain false. Browser capture recovery and semester job execution remain later increments;
no daemon, polling or startup allocation is introduced.

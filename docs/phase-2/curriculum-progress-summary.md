# Curriculum-aware progress summary

`GET /api/users/:id/progress` resolves an assigned account's curriculum, records,
numeric attempts, available courses and rating prior in one repeatable-read snapshot.
The existing owner/admin guard and UUID/student-ID aliases remain in place.

Current-member records use context placements and difficulty estimates. Records outside
the current membership remain visible in `historicalRecords` with basic course identity;
their stored status, elective claim and legacy grades are preserved. This read does not
rewrite history or infer a claim for another curriculum. An empty context returns empty
active lists rather than falling back to the global catalog.

Availability shares the recommendation policy: every context prerequisite is mandatory,
completed/in-progress courses are excluded, unplaced courses are excluded, and the
highest member numeric retakes determine the GPA fork. The placement filter preserves
earlier appearances of an elective even when its Y4S2 appearance is excluded. A planned
course can remain available once its prerequisites are completed.

Earned credits exclude physical training; completed course counts retain those required
records. `totalCourses` counts unique curriculum members, not required graduation choices.
`totalCredits` is nullable reference metadata. `percentage` is null and the scope declares
`degreeProgressAvailable: false`: repeated elective options and unfulfilled free-elective
requirements cannot be turned into a verified degree denominator. Accounts without an
assignment retain the legacy response shape and catalog calculations.

Twelve PostgreSQL regressions cover context isolation, historical preservation, all
prerequisite flags, availability agreement, exact-70/highest-retake policy, repeated
placements, physical-training credits, reference totals, rating priors, aliases, access
control, empty contexts and unassigned compatibility. Existing recommendation and access
regressions pass alongside them. An independent subagent review found no blocking issue; its two requested assertions for
eligible planned courses and non-null historical claims were added before final verification.

No assignment API, selector or client context activation is introduced. Legacy profile
and raw record projections, client DTO handling and context semester planning remain
separate increments. Verified degree/elective rules are required before degree estimates.

# Coherent semester allocation preview

`GET /api/admin/semester-allocation-preview` requires current cookie ADMIN access and an exact
`curriculumId`, `semester` and four-digit `year`. Extra query fields and nonempty bodies reject;
callers cannot upload participants, grades, utility scores, credit targets or results.

The producer reads the scoped STUDENT cohort, curriculum context/ratings, progress, numeric
grade attempts and resource settings in one RepeatableRead database snapshot. Its four
recommendation/resource/allocation/utility policies are validated and copied before the first
await. Normal reads release that snapshot before the bounded allocation and replay work;
the internal producer can share a caller's coherent transaction for later explicit capture.

Inputs use the existing eligible planned/reference-recommended union. Every contextual
prerequisite remains mandatory, including recommended/corequisite flags. Numeric GPA uses
the highest retake score per course and the existing exact fork policy; an unknown GPA defers
fork-only placements. Supplied choices stay frozen through every simulated round, so choosing
a prerequisite never unlocks a dependent within the same semester.

The member course catalog supplies current stored planning credits. Credits must be whole
numbers from zero through ten; unused catalog members remain in the ledger. Physical-training
planning credits are retained without applying completed-credit/GPA exclusions. Every student
receives the captured recommendation `maxCredits` as a reference target. The response declares
`targetCreditsBasis: CONFIGURED_REFERENCE_MAX_CREDITS`; these are not individually verified
budgets or graduation estimates. Utilities use the captured Bayesian difficulty/immediate-
unlock policy, with the existing shared capacity/congestion allocation weights.

The scoped cohort is counted first, after fresh authorization. More than 500 students rejects
before loading their histories. Catalog bounds and credits are checked before those histories;
the produced union supports at most 100 choices per student and 10,000 choices total. These
bounds do not cap every student's raw progress/retake history or guarantee a request duration.

The strict public preview includes a coherent aggregate summary, captured recommendation and
utility policies, `consistencyBasis: SINGLE_DATABASE_SNAPSHOT` and `persisted:false`. It reports
credit totals/shortfalls, stop reasons, course demand/assignments, rounds and the retained shared
section ledger. It excludes all participant identifiers, candidate utilities, private choices
and per-student assignment traces. The private server result remains internal for a later
capture; aggregate demand and scope must match the captured source. No run, participant, job,
plan, grade, progress or resource write occurs when reading a preview.

Missing resources remain unknown and never create invented capacity. Eligibility, allocation,
calendar and timetable metadata remain reference-only and unverified. Existing one-course
preview/storage/worker paths remain separate. The next increment adds explicit server-produced
capture and protected historical aggregate/owner reads, followed by browser recovery; no
background daemon or automatic allocation is introduced here.

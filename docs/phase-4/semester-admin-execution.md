# Protected exact semester execution action

ADMIN POST `/api/admin/semester-allocation-jobs/:id/execute` explicitly executes or
recovers one selected semester request. Strict input contains its expected curriculum,
semester/year and acting-account UUID only. The path job ID is the retry identity; new
retry keys, replacement results/participants/model/policies and query overrides are rejected.

Every bounded fresh Serializable transaction locks the cookie actor with `FOR SHARE`,
checks current ADMIN and expected identity before job lookup, then compares the selected
scenario before terminal verification, recovery or claiming. The acting administrator may
differ from the original author; the original author's lock, provenance and unavailable-author
failure remain unchanged. Replay still requires a current authorized actor and exact scenario,
but never reinterprets the frozen result from today's cohort/resources/policies.

The existing atomic semester worker serves both trusted CLI and protected HTTP. Its private
capture, participant rows and terminal outcome commit together, with exact provenance and
whole-result replay. A strict private-free `{processed,outcome}` reply requires a terminal
state when processed. A busy job can return unprocessed PENDING from its read snapshot;
inspect the exact outcome before retrying uncertain execution. There is no automatic retry
of unknown writes, browser control, timer or queue drain in this increment.

No new migration, stored V1 format change, official registration, academic-plan update,
curriculum activation, reset or reseed is introduced. Browser controls/recovery follow next.
Large-semester profiling and curriculum/subject/calendar/staff/lab verification gates remain
open. Verified checks are recorded in AGENTS.md.

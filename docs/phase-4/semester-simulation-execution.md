# Explicit one-job semester simulation execution

`npm run semester-allocation:run-one --workspace=server -- --apply <job-uuid>` explicitly
processes one selected semester request. It is a trusted local operator command, not a
timer, startup hook or queue drain. Browser execution is a separate increment. Enqueue
receipts remain original intent; ADMIN GET `/api/admin/semester-allocation-jobs/:id/outcome`
reads a coherent private-free pending or immutable terminal outcome.

One bounded Serializable transaction claims the job with `FOR UPDATE SKIP LOCKED`, holds
its current author role with `FOR SHARE`, and produces the existing bounded semester V1
simulation from a single database snapshot. The capture, private participant outcomes and
terminal execution save together. A separate random private capture key and explicit
immutable job link prevent reuse of a direct capture that happens to share a queue key.
Existing direct captures retain a null job link; frozen public V1 formats remain unchanged.

Terminal recovery verifies the exact job/execution/run links, creators, scope, model/version,
chronology and complete private participant replay before returning its small public result.
It does not consult current policy, cohort, grades or resource inputs. Deleted or demoted
authors of pending requests receive `AUTHOR_UNAVAILABLE`; confirmed producer domain
rejection receives `PREVIEW_UNAVAILABLE`. Unknown, corrupt configuration/state, SQL and
transport failures escape and roll back all writes, leaving the request pending. A skipped
locked job can return PENDING from its read snapshot; it does not claim that another worker
has finished or failed. Read the exact outcome again after an uncertain execution.

The additive terminal table has strict success/failure checks, restricted unique run/job
links and immutable updates. Insert triggers check private capture provenance and terminal
chronology, including rejecting a capture attached after failure. Existing immutable run
protection freezes the new nullable job link. Creator and participant deletion still detach
live links without erasing captured private identifiers or reattaching recreated accounts.

Known serialization/unique conflicts retry at most five fresh transactions. Worker/outcome
reads use explicit 3s acquisition and 30s execution budgets; these are limits, not latency
guarantees. No automatic retry of unknown failures, official registration, academic changes,
curriculum activation, reset or reseed is introduced. Semester-specific large-cohort timing
and verified curriculum/subject/calendar/staff/lab gates remain open. Verified checks and
the next small increment are recorded in AGENTS.md.

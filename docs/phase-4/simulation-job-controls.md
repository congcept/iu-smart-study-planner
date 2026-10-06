# Admin simulation request controls

The admin resource dashboard now includes a **Simulation request** section for its selected
reference curriculum, semester and year. It extends the existing resource/preview/history
workflow and preserves unsaved resource fields and their separate recovery journal.

1. **Queue simulation request** stores the account/scenario request key in this tab before
   sending an explicit enqueue. Queuing records a manifest; it does not capture inputs or
   execute the allocation.
2. **Check request outcome** reads the original receipt and current outcome. Recovery on
   mount only reads an already known job. An unconfirmed enqueue requires an explicit
   **Retry queued request**, using the same durable key.
3. **Execute selected request** is available only after a verified PENDING outcome. It
   sends the current expected administrator and exact scenario to the protected action.
   It executes the existing reference one-course round against inputs read at execution.
4. On success, the panel shows the saved aggregate run ID and points to the existing
   history browser. Reload history to inspect its immutable details. A confirmed terminal
   result permits an explicit **Queue another request** with a new key.

No request is enqueued or executed on mount, refresh, recovery, or a timer. There is no
polling or automatic retry. A lost execution response removes the executable state until
the user explicitly checks the original job's outcome. PENDING includes another active
transaction and does not mean no worker is running. The immutable QUEUED receipt is never
presented as current execution state.

The journal is keyed by normalized administrator and full scenario in `sessionStorage`.
Strict validation, conditional writes and read-back confirmation preserve pending keys
and prevent replacing a known receipt under the same request. Denied, malformed, changed
or unverifiable storage blocks writes until recovery succeeds. No control silently clears
a pending journal. A same-key retry never creates a replacement request.

Every network operation checks the current cookie session before sending and again before
publishing server data. The panel remounts by account/scenario and rejects stale successes
and failures. Execution verifies the journal both before and after asynchronous session
authorization, immediately before POST. Server expected-account and scenario checks remain
authoritative. The browser also validates strict reply schemas, exact IDs/scopes and
receipt/outcome enqueue chronology. The action has a 20-second browser timeout; an uncertain
response is recovered through the original outcome, rather than treated as a failed commit.

The current section recovers the latest request in this tab. It is not a global job queue
browser, cancellation interface, or individual allocation editor. The worker's bounded
atomic execution and existing simulation limits still apply. Full-semester allocation,
per-student persistence, larger-input worker design and verified curriculum/calendar/
resource/category/grade-fit metadata remain separate work. No student assignments, plans,
grades, completions, curriculum assignments or resource settings are changed by these
controls.

Focused verification covers API envelope/ID/scope/privacy checks, journal ownership and
conditional writes, denied/tampered storage, receipt-write uncertainty, explicit retries,
session/scenario isolation, concurrent clicks, strict outcome chronology and preservation
of unsaved resource edits and ambiguous resource-save recovery. Responsive QA uses isolated
fixtures; it does not execute the user's live queue.

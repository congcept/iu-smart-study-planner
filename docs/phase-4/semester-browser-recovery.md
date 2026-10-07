# Browser semester request recovery foundation

Separate semester-job adapters validate all local inputs before I/O, then confirm the fresh
cookie account is the expected administrator before and after every successful or failed
data request. Local arguments are copied before awaiting authorization; identity is never
sent as a read override. The one explicit enqueue carries the server expected-actor guard.
Exact receipt reads compare the entire original immutable receipt. Outcome and execution
replies must match its identifier, scenario, model and exact queued timestamp. A confirmed
terminal outcome cannot change or regress; pending may advance to a terminal result.

Execution uses the selected job ID as its retry identity and accepts no new key or
replacement inputs. Adapters never retry, poll or write browser storage automatically.
Lost replies remain uncertain and require explicit same-key/same-job recovery. Data
requests use 40s transport budgets; the server's five bounded transaction attempts can
outlast that budget, so timeout does not imply rollback or terminal failure.

The tab journal uses a separate owner/scenario namespace and stores only strict enqueue
intent plus an optional full queued receipt. A durable pending key must exist before a
receipt can be attached. Request identity and known receipts cannot be changed or dropped.
Synchronous conditional writes verify exact observed bytes and read back the saved value
immediately before a caller's explicit POST. Changed, corrupt, denied or uncertain storage
blocks replacement; valid existing noncanonical bytes survive read-only confirmation.
Write adapters accept a synchronous final-confirmation callback after fresh account preflight
and immediately before POST, without an intervening await. The panel must use this hook for
durable journal/generation confirmation; a throwing or asynchronous confirmation blocks
submission. This closes the account-preflight wait gap without putting storage in the adapter.

Replacing a request requires a previously observed receipt and an empty next receipt.
The caller must freshly confirm the old terminal outcome before requesting replacement;
the journal neither stores nor certifies execution outcomes. Account/scope isolation,
mounted generation guards, exact retries and publication of receipt/outcome together still
belong to the next admin panel increment. These adapters/journal are a tested foundation,
not a newly visible browser feature. Existing one-course/capture journals remain unchanged.

No API/database migration, automatic worker, academic write, activation, reset or reseed is
introduced. Full validation and next direction are recorded in AGENTS.md.

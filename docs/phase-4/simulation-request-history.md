# Bounded simulation request history

`GET /api/admin/allocation-jobs` reads one page for `curriculumId`, `semester` and a strict
four-digit `year`. Optional `after` is the normalized UUID of the last request on the
previous full page. Additional query fields and body overrides are rejected. Cookie ADMIN
access is required and the current database role is checked inside the read transaction.

The private-free response contains `kind: SIMULATION`, `usage: REFERENCE_ONLY`, the exact
scope, `order: QUEUED_NEWEST_FIRST`, `pageSize: 20`, up to 20 `jobs` and nullable `nextAfter`.
Each job uses the existing strict outcome contract: selected public job ID, immutable enqueue
time/scope, PENDING or terminal state, and a public saved run ID or fixed failure code.
Original author identities, retry keys, student identities, individual grades and raw
infrastructure failures are excluded.

Ordering uses immutable `(createdAt DESC, id DESC)` enqueue metadata, with the UUID breaking
timestamp ties. Pagination reads at most 21 rows, verifies the look-ahead as well as visible
rows, and uses the final visible job ID as continuation only when there is another row.
Unknown or different-scenario cursors return 409 and require reloading the first page.
Missing curricula return 404; an existing empty scenario returns a valid empty page.

Authorization, curriculum/cursor checks and joined job/execution/run reads share one
RepeatableRead transaction. Each page is internally coherent. Outcomes can change between
pages or refreshes; this is not a frozen queue snapshot or an execution-state cursor.
Newly enqueued requests appear on a first-page reload rather than being inserted into an
older continuation. PENDING includes work whose terminal transaction has not committed.

The API validates each included outcome using the same pinned V1 capture/provenance checks
as an individual outcome read. Corrupt cursor, visible or look-ahead history fails closed
with a generic error; it is never silently skipped. Historical results remain readable
after creator anonymization or live policy changes and are never recomputed. The request
history read never calls the worker, captures inputs, drains a queue, or changes academic
data, resource settings or saved jobs.

The bound limits rows, not the size of all stored capture JSON or parsing cost. Reads can
still fail on excessive/corrupt historical data or database errors. Clients must explicitly
retry the exact failed continuation or reload, and must validate scope, ordering, IDs and
continuation boundaries. A scenario request browser remains the next client increment;
the current request control still recovers the latest tab receipt only.

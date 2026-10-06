# Simulation request history browser

The selected `/admin` resource scenario includes a read-only request browser between the
current tab's request controls and saved aggregate capture controls. It reads the latest
twenty queued requests for that exact curriculum, semester and year. Each row shows its
public ID, immutable enqueue time and the current outcome observed by that page's server
snapshot. PENDING includes executions without a committed terminal outcome.

Load older requests replaces the page rather than accumulating unbounded rows. The
continuation retains its exact last-row ID and enqueue boundary. A failed continuation can
be retried explicitly with the same boundary; Reload request history starts again with the
latest page. The client validates the strict shared page contract, exact scope, descending
enqueue chronology, distinct IDs and an older-than-boundary relationship for every returned
row. Unknown or corrupt responses fail closed rather than being displayed.

View request outcome performs a separate explicit GET for the selected public ID. Its scope
and immutable enqueue time must match the chosen row. A previously terminal row must retain
the same terminal status, completion time, run ID and failure code; a PENDING row may advance
to a committed result. SUCCEEDED points to a public saved aggregate capture in the existing
run-history browser. FAILED explains only the fixed public failure reason. The browser
never obtains private author IDs, retry keys, student identities or infrastructure details.
An explicit detail read updates that row to its later verified outcome; other rows retain
their page snapshot. Known terminal results survive failed reads and matching-ID refreshes.
Observations remain bounded to the current page; successful page replacement discards
off-page observations rather than accumulating history in memory.

Fresh account checks before and after reads require the same current administrator. An
owner/scenario keyed remount and generation guards discard late replies after account,
curriculum, semester or year changes. A single pending read disables competing browser
actions. Selected details are cleared on page changes and failed reads; retry targets the
original selected request. There is no polling, enqueue, execution, automatic retry, or
storage write in this browser. Resource edits and existing resource/capture/current-request
recovery journals remain separate and preserved.

The view inherits the admin section layout, wrapping public IDs and allowing row actions
to stack on small screens. Buttons have a minimum 44-pixel height. The bounded list is a
request browser, not a live queue monitor or full-semester allocation. Historical capture
parsing cost, one-course execution/time limits, verified curriculum/category/grade-fit and
resource/calendar metadata, per-student persistence and deployment remain open work.

# Saved semester course references

In Planner, open a saved plan, select **View courses** on a saved semester, and review its
recognized course references. Current catalog codes/names are shown in stored array order.
Missing catalog rows are explicitly unavailable; no labels or credit totals are invented.
Back to saved semesters performs a fresh semester-list read before displaying it again.

These references do not establish the original curriculum, current placed membership,
prerequisite/GPA eligibility or timetable validity. The view is read-only: no course progress,
plan activation, academic records or stored JSON are changed.

## Recognition policy

The existing writer and seed use arrays of exact `{courseId, position}` objects. The reader
recognizes the complete array only when every entry matches: normalized UUID, signed safe
integer position, no extra keys and no duplicate normalized course IDs. Negative, duplicate
or noncontiguous position values remain intact. Position is not used to invent an academic
order; the original array order is preserved. An empty recognized array is a real empty list.

The reader accepts at most 100 entries and 65,536 UTF-8 bytes of PostgreSQL's JSON text
representation. These are display/transfer safeguards, not university limits or new write
restrictions. Unsupported content is reported as unsupported; content beyond reader bounds
is reported as exceeding display limits. No partial list is salvaged, silently truncated or
repaired. Unavailable content remains stored exactly as it was.

## Protected API and bounded transfer

`GET /api/users/me/study-plans/:planId/semesters/:semesterId/courses` has strict normalized
identifiers and accepts no query/body fields. The cookie supplies the account. Even an
administrator receives only their own selected plan/semester. Missing and foreign plans or
semesters share one 404 response.

The account/current curriculum scope, owned plan, owned semester metadata, guarded JSON and
current catalog labels share one RepeatableRead snapshot. The ordinary semester query does
not select `courses`. A PostgreSQL nested CASE returns its JSON payload only for arrays within
both bounds, avoiding arbitrary JSON materialization in Node. Nonarray inspection cannot
call `jsonb_array_length`. Exact PostgreSQL numeric checks reject fractional or unsafe
positions before driver decoding can round them into apparently valid JavaScript integers;
mathematically integral values such as `1.0` remain recognized. This bounds transferred saved JSON and catalog lookup cardinality;
it does not establish a hard limit on PostgreSQL JSON inspection cost or total endpoint memory.

Recognized references resolve only current catalog ID/code/name. The response excludes raw
JSON, grades, difficulty, progress, inferred membership and calculated totals. A null catalog
entry preserves the saved reference without claiming the course still exists. Strict shared
DTOs always retain `studyPlansValidated: false`.

## Browser recovery and verification

The adapter confirms live account/context before and after successful or failed reads, then
binds the strict response to the selected plan and semester. Cancellation is checked across
session waits. Account/plan/semester/context remounts and abort/generation guards discard stale
replies. Pending/errors hide old labels. Parent selection replaces the semester list, rejects
batched stale clicks, and returns through a fresh read. Existing owner/scope/focus behavior is
preserved. Unavailable format, display limit, missing catalog and genuine empty list have
distinct copy.

Backend/shared code was reviewed by the coordinator; a separate agent reviewed the client
and integration. Focused adapter, rendering and navigation cases pass; full quality evidence
is recorded in AGENTS.md. Real PostgreSQL cases cover ownership, uniform errors, query
projection/guards, malformed/oversized content, normalization, historical ordering, coherent
concurrent changes and no writes. Browser geometry is not claimed without a real visual run.

Next planning work must preserve these reference boundaries. Current curriculum membership
annotations or verified saving require separate explicit policy and checks; recognizing a
stored course ID alone does not complete those gates.

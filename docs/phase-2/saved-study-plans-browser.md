# Read-only saved study plans

The protected Planner now has a separate account-owned metadata browser. Saved plans are
not the current planned-course selections shown in My curriculum. Their stored active flag
is described as a previous choice, not a verified schedule.

## Account-owned read

`GET /api/users/me/study-plans` takes only an optional UUID `after` query. The authenticated
cookie determines the account; even an administrator cannot request another account through
this endpoint. Unknown query/body fields reject. Current user/curriculum identity, an owned
continuation boundary and the metadata page share one repeatable PostgreSQL snapshot.

Pages contain up to five plans ordered by creation time and UUID descending. The query reads
at most six rows for lookahead. A non-null `nextAfter` identifies the last plan of a full page.
Foreign, deleted and missing cursor identities return the same 409 recovery error. Cursor
pagination is a new snapshot per request; this does not freeze mutable plan metadata across
pages. Reload returns to the newest plans.

The strict shared response includes account scope with `studyPlansValidated: false`, plan
identity/name/description, stored active flag, creation/update timestamps and semester count.
It does not load or return semester course JSON, stored credit/difficulty totals, grades or
other account information. Existing plans have no curriculum identity. Assigning the account
to a curriculum does not retroactively validate its older plans.

## Browser behavior

The API adapter confirms the live cookie account and curriculum before and after successful
or failed reads. It validates returned scope, requested cursor, strict metadata shape and
older-page ordering against the confirmed boundary. Inputs are copied before awaiting work.
The panel uses account-keyed local state, cancellation and generation guards; it does not
populate the unused global study-plan cache. Pending/errors hide previous plan metadata.
Focus/visibility refresh checks the newest page. Retry repeats the failed read; unavailable
cursors return through reload. Account failures require a fresh confirmed account read.

The panel shows plan names, descriptions, previous active marker, timestamps and saved
semester counts. Loading, empty, retry, reload, latest and older-page states are accessible
through semantic headings, status/alert text and buttons. It has no save, edit, delete,
activation or import action.

## Scope and validation

The new read does not change existing legacy write behavior. Those semester writes do not
yet enforce all mandatory earlier-slot prerequisites or GPA eligibility. Saving a preview
requires a separate atomic server validation design and a confirmed reference-slot/calendar
mapping; exposing a save button here would overstate existing guarantees.

Official curriculum activation/assignment, verified schedules, timetable, capacity, staff/lab
and deployment remain separate gates. The client explicitly describes curriculum,
prerequisites, GPA and timetable validation as pending for saved references.

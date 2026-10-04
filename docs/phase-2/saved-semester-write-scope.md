# Saved-semester request intent

Semester creation and updates accept an optional strict `expectedScope` containing the
plan owner's UUID and explicit stored curriculum UUID/null. The existing Serializable
transaction compares it after current actor authorization and nested-resource lookup,
before totals or any save. A mismatch returns 409 without changing courses, totals,
metadata or timestamps. Admin writes use the plan owner's scope, rather than the admin's.

Membership validation alone cannot detect intent changes when a selected course is placed
in both the previous and current curriculum. The scope precondition covers that case,
including empty course lists and metadata-only edits. Scope-less legacy requests retain
their existing behavior. A matching metadata-only edit preserves historical cached course
lists/totals; explicit course-list saves still satisfy current placed membership.

The shared create/update schemas now own the previous route rules: strict root/entries,
normalized unique course UUIDs, unchanged integer positions/year and original list order.
Updates require a defined semester/year/course-list field; scope alone is not an edit.
Routes, adapters and direct services reuse these schemas. Scope is removed before Prisma
spreads and never becomes stored course JSON. Direct validation errors reject as promises.

Twenty-one new PostgreSQL and thirty-one adapter cases verify stale null/assigned/shared
contexts, owner/admin and nested-resource precedence, malformed scope, no-write evidence,
normalization, direct calls, empty lists, ordering and historical metadata preservation.
Independent source review found no blocking issue. Full quality totals are in AGENTS.md.

These adapters have no current production UI save caller. This increment establishes the
write contract; it does not activate a semester editor, assignment or curriculum selector.
Next work is the required simulation-only school-admin resource foundation.

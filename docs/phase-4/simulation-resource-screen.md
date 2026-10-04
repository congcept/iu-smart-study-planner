# Admin simulation resource screen

The protected `/admin` route lets a signed-in school administrator configure resource inputs
for a reference curriculum, semester and year. The header link is visible only to admins;
the nested route guard denies other roles. Before private reads, writes and confirmation,
the screen refreshes the cookie session and verifies the expected account and ADMIN role.
The server continues to authorize and audit the actual cookie actor in its transaction.

This is a simulation input screen, not a demand or allocation dashboard. Selecting a
curriculum does not assign it to an account, validate offerings, or open reference-only
student editing. Missing configurations remain explicit. All four base inputs start blank
until entered; zero resource counts are valid, and section size must be positive.

## Selection and overrides

The public curriculum list is runtime-validated, rejects duplicate normalized IDs, and
retains the `REFERENCE_ONLY` usage marker. Changing the selection loads a new resource
snapshot and member-course reference; late responses cannot replace a newer selection.
Reload explicitly replaces unsaved edits. There is no automatic focus refresh that silently
discards a form draft.

Course overrides are optional capacity and/or professor counts for unique member codes.
Both placed and unplaced reference members are available. Historical overrides for removed
members remain visible and can be removed; they cannot be resaved as current members.
Saving replaces the entire override list, including an explicit empty list.

## Revision conflicts and recovery

Every save uses the loaded revision, or zero to create an absent configuration. Before
POST, a strict owner-scoped tab journal preserves the complete immutable replacement and
its original revision. Pending, corrupt or wrong-owner journals block new writes and
selection changes. Storage failures prevent a new POST; failed cleanup preserves recovery.

The POST response alone does not retire the journal. A fresh authorized GET must confirm
the original scope, exactly `expectedRevision + 1`, the expected audit actor and every
requested setting. Override comparison ignores JSONB object key order. A later revision,
another actor or different values cannot confirm the request, even if POST reported success.
Lost responses use this same read confirmation. There is no automatic or manual POST replay.

`Check saved settings` performs only reads. `Clear local request` removes this tab's recovery
copy, changes no server settings, and reloads current settings for review before another
save. A conflict never silently rebases the old request onto a newer revision. Requests from
an unmounted account session cannot update the next session or clear its journal.

## Remaining roadmap work

This increment consumes the persisted simulation resource API. Student demand, feasibility,
scarcity allocation, multi-objective scoring and the allocation dashboard remain separate
increments. CS/IT/DS source reconciliation and account assignment validation remain gated.

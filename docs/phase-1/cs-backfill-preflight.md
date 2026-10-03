# CS backfill compatibility preflight

Run `npm run inspect:cs-backfill --workspace=server` to inspect the checked-in CS reference
against local PostgreSQL. An optional source file is supported after `--`. The CLI validates
source structure first, then reads matching course identities and prerequisite edges in one
RepeatableRead transaction. It writes no courses, contexts, evidence or assignments.

Missing codes, ambiguous IDs/codes, conflicting exact names/credits, prerequisites whose endpoint
is outside the source membership and duplicate legacy edges block compatibility and return no
partial preview. Incoming dependencies of other programs' courses are ignored. A compatible
preview contains existing IDs, every repeated placement/group/requirement and copied edge flags;
flags are legacy provenance, never exceptions to the mandatory-prerequisite policy.

The report includes raw-byte SHA256, legacy provenance and READ_ONLY mode. Database compatibility
exits zero; conflicts exit one with structured issues. Invalid JSON/missing files fail with a
path-specific error. Compatibility does not establish signed cohort, institutional prerequisite
rules or verified graduation totals; no curriculum is activated by running this command.

The local database matches all 56 identities and 21 existing prerequisite edges while preserving
71 coded appearances and the uncoded three-credit requirement. Ten pure regression cases plus
build/typecheck/zero-warning lint, 478 server and 310 client tests pass. Source review ran inline
after the agent thread limit. Atomic/idempotent backfill and conflict-safe existing-context
validation are next; current readers and major selection remain unchanged.

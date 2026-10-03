# Semester course validation

Legacy semester create/update now validates every submitted course ID before writing
JSON or calculating totals. Unknown courses and duplicate IDs (including UUID case
variants) return 400 without changing the saved semester. UUIDs normalize to lowercase.
Nested course rows and outer bodies reject unknown fields; empty updates are rejected.

Empty course lists remain valid and produce zero credits/difficulty. A metadata-only
update retains course JSON and previously calculated totals. Positions and course order
remain intact; owner/admin and nested-plan access checks still apply. Physical-training
credits still count toward semester workload. No migration or seed reset is needed.

Verified with 22 real PostgreSQL tests plus the full quality gates.

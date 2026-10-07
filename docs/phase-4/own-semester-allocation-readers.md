# Validated own semester simulation readers

Browser-only readers prepare protected own-history browsing and selected-result inspection.
They validate a strict local expected owner UUID, then check the current cookie account before
and after both successful and failed reads. The owner precondition is never transmitted as
an alternate server identity. Later role/curriculum changes remain compatible with historical
own access. These guards complement server live-FK authorization; a future mounted view must
also discard stale generations/account transitions before publishing returned values.

History queries contain only the normalized optional continuation. A continuation requires
the exact validated previous boundary and every returned row must precede its storage-time/
identifier order, including submillisecond timestamp precision. The response's requested
boundary must match. A first page accepts no leftover boundary. Strict frozen owner/page schemas
reject private data, inconsistent math, excessive rows and official-validation claims.

Exact-result reads normalize the identifier and reject a different result. When the selected
history receipt is supplied, every canonical field must match the immutable exact read before
it is returned. Network/validation failures still check the current account before exposing
an error. The 40s transport timeout accommodates the bounded history service's explicit
30s execution/3s acquisition budgets without promising those latencies. No POST, cache/storage
write, polling, academic/resource change or UI is introduced. Twenty-six reader cases cover
account changes, failed-read confirmation, strict contracts, page boundaries and immutable
receipt identity. Full gates and the next visible reading increment are recorded in AGENTS.md.

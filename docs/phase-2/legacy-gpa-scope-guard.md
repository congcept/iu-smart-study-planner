# Legacy GPA response scope guard

The existing CS GPA hook now validates present grade scope against the expected account
and rejects assigned curriculum contexts. A changed cookie owner or assigned fork/nonfork
response cannot drive the legacy CS target, path or manual controls. Invalid metadata fails
closed through the existing retry state. Matching unassigned numeric/null summaries work;
server path authority, exact-threshold behavior and guest manual choice remain unchanged.

Seven new hook cases cover matching scopes, another owner, assigned fork/nonfork contexts,
malformed metadata, focus refresh invalidation and retry. Build, types, zero-warning lint,
721 server tests and 470 client tests pass on the exact isolated source snapshot, including
existing map/GPA regressions. No visual layout changed. Review was inline after the account
usage limit prevented further subagent review.

Scope-less grade replies remain compatible with the legacy hook. They are not evidence of
an unassigned account: the protected map's parent separately requires fresh explicit null
session context before mounting it. Actual current server replies include scope. This guard
does not supply atomic expected-owner/context preconditions for later mutations. Those write
preconditions and context-aware progress/cache isolation are the next development direction;
account assignment and the major selector remain gated.

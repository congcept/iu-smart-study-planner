# Assigned-context editing

The map and planner were the app's main functionality and were switched off for every student who had
a curriculum attached. This is what changed and what it did not.

## The server was never the obstacle

Every piece of context-aware behaviour already existed:

| Concern                                                               | Where                                       |
| --------------------------------------------------------------------- | ------------------------------------------- |
| context-aware completion, elective claims, external prerequisites     | `server/src/services/studentRecords.ts`     |
| scope precondition — compares owner and curriculum, never forbids one | `server/src/services/progressWriteScope.ts` |
| progress read returns the account's own scope                         | `server/src/services/studentProgress.ts`    |
| contextual planner preview, server-computed                           | planner preview service                     |
| in-context save with prerequisite and GPA checks in one transaction   | saved reference selection                   |

The lock was three client-side decisions: hydration refused a snapshot with a curriculum, the write
path required a null scope, and the curriculum route rendered the reference view instead of the map.

## What now happens

**Hydration accepts what the server reports.** A snapshot's scope becomes the precondition every later
write must match. Two guards survived deliberately:

- the **owner-keyed browser cache still holds unassigned selections only** — an assigned snapshot
  written there would overwrite the legacy selections and be resurrected on detach
- the marker that retires the pre-assignment archive is set **only by an unassigned snapshot**, so
  visiting a program cannot silently discard what the browser held before

A confirmed snapshot also updates the stored scope, which keeps the next write's precondition current
instead of stale. A write that finds a changed context still conflicts rather than guessing.

**The map is built from the program.** A new adapter turns the curriculum's placements into the
semester columns the map already understood: duplicates keep their own elective groups, a course the
document gives no slot stays namable but unplaced, and an unnamed elective slot gets a card that says
candidates are not listed rather than inventing them.

**Three figures stopped being inherited from the global catalogue.** The program total now comes from
the program, and a document that declares none reads as unknown instead of borrowing 130. The
completed-credits line prints a denominator only when one was declared. The recommendations switch is
hidden where the scorer behind it does not run, because that scorer encodes one program's final-year
rule and applying it elsewhere would recommend by a rule the program does not have.

**The GPA path comes from the server inside a program.** The hook refused an assigned scope before,
which would have left editing paused with the feature present and inert. Inside a program there is no
manual fallback: an unknown path stays unknown and the map defers its path-dependent choices.

## What is not built

The planner page still shows a **read-only contextual preview**. Planning is persisted — a planned
course becomes a `PLANNED` record written with the assigned scope — but through the map, not through
the planner's own save control. Bringing the preview's save path onto the existing reference-selection
transaction is the remaining increment.

Offerings, calendar validity and the graduation percentage remain unknown, and the banner above the map
says so rather than the screen withholding the feature.

## Verification

111 client files / 2,529 tests and 121 server suites / 3,085 tests pass, with build, typecheck,
zero-warning lint and formatting.

Nine tests failed when the policy changed. Each encoded the old behaviour and was rewritten to assert
the new one rather than deleted — and the two that guard the hazards above were kept, because those are
the ones that matter when the policy changes again.

Not verified: the browser flow itself. The client changes are covered by jsdom tests and the server
path by real-database suites, but nobody has clicked through an assigned account end to end. That is
the next thing to do before the progress check.

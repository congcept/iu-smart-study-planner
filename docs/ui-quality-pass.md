# Student planner UI completion

The semester map keeps compact bordered course nodes. Click marks completion or
undoes it; right-click toggles planning, including moving a completed course to
the plan. Focused course nodes also accept Shift+F10 or the Menu key for the same
planning action. Selecting a locked node reveals its prerequisites.

The visible green, blue, and gray control legend replaces the collapsible help.
Completed courses, remaining courses, and estimated finish remain distinct
readouts below the map. Ratings retain both their difficulty estimate and vote
count in a compact line. Existing GPA paths, account scope, elective claims,
imports, and mandatory prerequisite cascades are preserved.

The map supports native horizontal and vertical scrolling and touch panning.
Zoom normalizes native scroll offsets into its pan so it retains the viewed
location. Reset view clears pan, scale, and scroll offsets without changing
course selections. Semester headings remain aligned with their columns and
zoom controls sit outside the scrolling region.

Account navigation indicates the active route. Auth validation focuses and
describes the affected field; demo failures appear beside the demo controls.
Demo copy reflects the shipped admin simulation dashboard. Course suggestions
show their actual credit total alongside the limit, with recovery and empty
states. Workload results retain estimate limits and request isolation.

The unused ProgressDashboard redesign is excluded from this change: its legacy
contract needs separate work for contextual nullable credit targets.

Verification: 2,751 server tests against a dedicated seeded PostgreSQL database
and 1,923 client tests pass. Root lint, typecheck, production build, changed-file
Prettier checks, and whitespace checks pass. The map and sign-in screen were
reviewed at laptop and 390px phone widths, including scroll, zoom and reset.

# Demonstration scenario

**Decided:** 7 November 2026. A seeded demonstration uses the _populated_ student as the assigned
account, so the contextual screens show real history rather than an empty state.

**Status:** the scenario is declared; the populated identity still has to be provisioned. See
"Gap" below.

## Accounts

| Account                          | Role                                | Purpose                                        | Login                  |
| -------------------------------- | ----------------------------------- | ---------------------------------------------- | ---------------------- |
| `demo.populated@example.test`    | STUDENT, assigned to `CS-REFERENCE` | the contextual screens with history            | development demo login |
| `demo-student@example.test`      | STUDENT, unassigned                 | the legacy editable map                        | development demo login |
| `demo-school-admin@example.test` | ADMIN, unassigned                   | resource simulation and the assignment control | development demo login |

Two student identities are needed because the assignment changes behaviour rather than adding to it:
an assigned account loses the legacy editable map and its progress store becomes read-only. Showing
both side by side is the honest demonstration.

## Scenario values

| Item                     | Value                   | Basis                                                 |
| ------------------------ | ----------------------- | ----------------------------------------------------- |
| Reference curriculum     | `CS-REFERENCE`          | the imported reference program; not a verified cohort |
| Academic year            | 2026                    | scenario label only                                   |
| Semester                 | FALL                    | scenario label only, not an offering                  |
| Professors               | 5                       | simulation assumption                                 |
| Classrooms               | 6                       | simulation assumption                                 |
| Lab rooms                | 2                       | simulation assumption                                 |
| Max students per section | 40                      | simulation assumption                                 |
| Resource revision        | 1                       | created by the first save                             |
| Saved plan shown         | the account's only plan | stored metadata, unvalidated as a degree plan         |

Every number in the lower half of that table is a **typed simulation assumption**, not a university
fact. Nothing in the scenario establishes an offering, a room, a section or a registration decision.

## Walkthrough order

1. **Unassigned student** — `/curriculum` shows the editable semester map. Complete one course,
   observe the elective claim and the dependent lock. `/planner` shows the legacy workload analysis.
2. **Administrator** — `/admin` shows the reference assignment control. Select the populated student,
   choose `CS-REFERENCE`, attach. The reply is labelled `REFERENCE_ONLY` and `changed: true`.
3. **Assigned student** — `/curriculum` becomes the read-only reference with placements,
   prerequisites, difficulty estimates and their vote counts, and a progress summary that separates
   current member data from preserved history. `/planner` becomes the contextual preview.
   `/grades` reports the contextual GPA and the retake history.
4. **Administrator** — the same scenario now has a non-empty cohort, so the planned-selection
   report, the capacity diagnostic and the allocation preview stop saying "no students assigned".
5. **Reversal** — clear the assignment and confirm the legacy map returns and the progress store is
   writable again. This is the part that proves the control is reversible.

## Caveats to say out loud, once each

- The curriculum is a **reference import**, not a validated cohort; its credit total is unknown and
  its degree percentage is withheld for that reason.
- The resource figures are **assumptions entered in a form**.
- The allocation preview is a **greedy simulation**, not a timetable and not a registration decision.
- The reference year and semester are **labels**, not a calendar.

## Gap

The populated identity does not exist on a fresh database. What the committed seed provides is
`IT2001001` (Nguyen Van A) with six legacy letter-graded completions and one study plan, but **no
password**, so that account cannot sign in. The `demo.populated@example.test` account described in
the October recap was created outside the seed on a previous machine's database and is not
reproducible.

Provisioning therefore needs one small, labelled step before the walkthrough can be rehearsed:

1. add a third demo identity to `server/src/services/demoAuthService.ts` (development only, like the
   existing two);
2. give it simulated completed records, numeric attempts, at least one rating and one saved plan —
   explicitly labelled simulated data, not a real transcript;
3. attach `CS-REFERENCE` through the shipped `/admin` control rather than by editing the database.

Step 3 is deliberate: the demonstration should exercise the path an administrator would use. Steps 1
and 2 are a provisioning increment with its own review, because they write academic-shaped rows.
Until that lands, a walkthrough can still be given on `demo-student@example.test` with an empty
context — it demonstrates the assignment and the read-only reference, but not the progress summary.

## Verification of the walkthrough

```bash
docker compose up -d postgres          # or the container equivalent
npm run db:generate --workspace=server
npm run db:migrate --workspace=server
npm run db:seed --workspace=server
npm run dev
```

Then, at 1280 and 390 pixels: complete the walkthrough above, confirm no horizontal page overflow,
keyboard focus visible on every control, and no axe violations on the assignment control.

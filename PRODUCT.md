# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The primary users are International University (IU), VNU-HCMC students reviewing
curriculum requirements, recording completed courses, and planning future semesters.
Computer Science (CS) is the current reference program. Information Technology (IT)
and Data Science (DS) are next; other schools are deferred.

School administrators are a required secondary audience in the thesis scope. Their
planned workflow concerns teaching resources, course demand, and allocation when
capacity is limited. The administrator role exists; its dashboard is not yet shipped.

## Product Purpose

IU Smart Study Planner helps students understand how their completed and planned
courses fit their degree requirements and prerequisite relationships. It makes a
curriculum actionable through an interactive semester map and saved progress.

Success means students can maintain an accurate record, understand what is available
next and why, and make a feasible semester plan. The thesis also requires demonstrating
how student planning can account for school resource constraints. These are intended
outcomes, not measured claims about graduation speed or academic performance.

## Positioning

The product combines IU curriculum rules, prerequisite-aware planning, elective-group
claims, and degree-progress tracking in one workflow. The intended thesis contribution
extends that workflow to consider both student needs and school capacity. Resource
allocation is a planned capability, not a current product claim.

## Operating Context

- **Device priority, confirmed during init:** laptop-first planning with useful phone
  access. Full parity for the planning workflow on phones is not a confirmed requirement.
- The current interface and course names are in English. Vietnamese localization remains
  an open decision.
- Students can explore an anonymous demo at `/`, create an account at `/register`, sign
  in at `/login`, and use their saved planner at `/curriculum`.
- The planner organizes courses by academic year and semester. Students review
  prerequisites, record completion, choose planned courses, and browse elective groups.
- The current implementation uses click, right-click, hover, and pan/zoom interactions.
  These describe the implementation; they do not establish adequate keyboard or touch
  access.
- The thesis uses simulated students and targets completion by the end of 2026.
  Development proceeds through small feature increments before broader curriculum
  coverage. Production deployment remains pending.

## Capabilities and Constraints

### Current functionality

- The CS semester map supports completed and planned courses, prerequisite locking,
  elective-group selection, degree progress, and a final-semester GPA-path toggle.
- Signed-in progress is stored on the server. Anonymous demo progress remains local
  to the browser and is never automatically imported into an account.
- Saving, hydration, and recovery states protect progress from stale responses and
  failed writes. Existing account-local selections are archived before the first
  server hydration; importing those archives remains pending.
- The current planner includes recommendation highlights and workload-intensity
  controls. Ratings-informed scoring and school-capacity-aware recommendations remain
  pending; existing heuristics must not be presented as validated predictions.

### Academic and data rules to preserve

- Every recorded prerequisite relationship is mandatory under the confirmed project
  policy, including rows previously described as recommended or corequisite.
- Removing completion of a prerequisite also removes completion of all its completed
  transitive dependents. The server is authoritative for signed-in accounts.
- A completed elective belongs to the group in which it was selected and must not
  count again through another group.
- In the current CS model, Physical Training 1 and 2 (`PT001IU`, `PT002IU`) are required
  but excluded from completed-credit totals. They still count toward planned credits.
- The current CS final-semester path uses GPA above 70 for Thesis (`IT058IU`) and a
  41-course degree target; GPA at or below 70 uses the alternative courses and a
  43-course target. Degree-progress percentage uses completed-course count divided by
  that target. Do not transfer these rules to IT or DS without source verification.
- The confirmed future retake policy uses the highest course score for GPA. Retake
  history, grade entry, and the GPA dashboard remain pending.
- Curriculum placement and prerequisites must respect the program and cohort. Shared
  course identity does not justify merging different programs' prerequisite rules.
- Official signed curricula and page HTML have unresolved differences. Preserve source
  provenance and validate a coherent curriculum before claiming IT/DS support.
- Keep accounts and guest progress isolated. Authentication uses an httpOnly cookie;
  browser storage is a confirmed-progress cache, not authentication-token storage.

### Remaining scope

Validated multi-curriculum selection, archived-progress import, grades and GPA,
course ratings, ratings-informed recommendations, school resources and allocation,
and the administrator dashboard are outstanding. School administration is required
for the thesis, not an optional stretch feature. See `AGENTS.md` for the maintained
implementation record and locked architecture decisions.

## Brand Commitments

The existing product name is **IU Smart Study Planner**. Preserve IU course codes,
course names, and academic terminology when presenting the supplied curriculum.
No additional voice, visual identity, or university-endorsement commitment was
established during init.

## Evidence on Hand

- `AGENTS.md`: confirmed scope, academic policies, architecture decisions, and current
  implementation progress. Prefer this maintained record and current source over
  stale feature descriptions elsewhere.
- `client/src/App.tsx`: current navigation, account roles, and routed surfaces.
- `client/src/features/curriculum/CurriculumProgressMap.tsx`: incumbent student workflow.
- `docs/phase-2/current-student-progress.md`: account progress, isolation, and recovery.
- `docs/phase-1/cse-curriculum-sources.md`: official-source links, source comparison,
  and unresolved cohort/curriculum differences.
- The repository contains curriculum data, simulated/demo accounts, and regression
  suites. Their existence does not establish real-student adoption, recommendation
  effectiveness, university endorsement, or a production launch; do not invent such
  evidence or testimonials.

## Product Principles

1. Preserve academic correctness and explain prerequisite constraints in the student's
   planning context.
2. Protect saved work and clearly communicate whether changes are saving, saved, or
   need recovery.
3. Keep curriculum, cohort, account, and elective-group boundaries explicit so progress
   is never credited to the wrong requirement.
4. Prioritize the student's planning task while retaining school-resource planning as
   a required part of the thesis scope.
5. Make claims proportional to shipped behavior and verified evidence; distinguish
   heuristics, simulated results, and planned capabilities.

## Accessibility & Inclusion

Useful phone access is confirmed alongside laptop-first planning. Existing mouse-heavy
interactions require attention in future interface work. No formal accessibility
standard or specific assistive-technology requirement has been confirmed, and current
compliance has not been established. Required standard and localization scope remain
open decisions.

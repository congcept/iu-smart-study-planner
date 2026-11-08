# The reference program is trusted as the author's manual check

Decision, 2026-11-08: the Computer Science reference program is **not** re-derived from its signed PDF.
It is the author's own manual verification of the currently published curriculum, and that is the
level of evidence the artifact carries for it.

## What this means concretely

- `CS-REFERENCE` stays as it is: one structure, no cohort year, no source hash, no committed manifest.
- Data Science and IT Network Engineering keep their verified manifests, because those were
  transcribed blind and needed the checks. CS was read by a person who could see whether it was right.
- The demonstration attaches a student to CS, which is now a supported choice rather than a gap: the
  program the walkthrough uses is the one a human vouched for.

## What it does not mean

**It is not a claim about prior years.** The artifact models the current published curriculum only. A
student admitted in 2023, 2024 or earlier followed a different plan, and no such plan is stored here.
The cohort mechanism exists and Data Science and IT use it; CS does not, because there is no
prior-year source to point a cohort at.

That distinction matters when the artifact is described. "Three programs are supported" is accurate.
"A student's plan is supported" is accurate for a current-year student. "Any IU student's plan is
supported" is not, and the thesis states the limit rather than implying it.

## Why the asymmetry is acceptable

Verification effort should follow the risk of being wrong, not symmetry between programs. The two
programs that were transcribed by an automated reader needed a verifier because a reader cannot tell
a wrapped row from a missing one — a mistake made four times in this project. CS was read by someone
looking at the page, which catches exactly the class of error a parser introduces.

What a manual check cannot catch is a change in the source after the check. That is why the reference
view says the data is unverified rather than asserting currency, and why no graduation total is
derived from it.

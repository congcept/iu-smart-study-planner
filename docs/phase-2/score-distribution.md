# Highest-score distribution

The protected Grades dashboard groups the server's GPA-included course scores into five
numeric ranges: 0 to below 20, 20 to below 40, 40 to below 60, 60 to below 80, and 80 to 100
inclusive. Scores keep their original precision when grouped. These are display ranges,
not institutional pass/fail bands or letter-grade conversions.

Each course counts once, using its highest score from `summary.courseScores`. Counts are
not weighted by credits and do not count retake attempts separately. Physical training,
zero-credit courses and attempts outside the current curriculum remain excluded by the
existing server summary; the separate immutable history still displays those attempts.
The chart never derives counts from GPA, summary totals, completions or history rows.

Visible exact counts and a semantic table remain readable without bar widths or color.
Bars show each range's share of all included courses and are decorative for assistive
technology. Empty summary data shows an explicit no-scores message. Account, loading,
error and saved-snapshot behavior is inherited from the dashboard: no separate state,
cache, request or storage is introduced. GPA computation and thesis-path policy are unchanged.

Focused checks cover fractional boundaries, 0 and 100, zero counts and an empty population,
updates from a new summary, retakes/excluded history, saved reconciliation and account/error
isolation. Interaction tests use jsdom; no browser geometry verification is claimed.

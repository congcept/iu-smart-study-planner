# Numeric grades and retakes

The user confirmed actual 0–100 course scores on 2026-10-03. This supersedes the
master prompt's letter-to-four-point conversion for new grade entry. Existing legacy
letter grades and gradePoints remain intact; numeric scores are never inferred from them.

The pure calculator selects the highest numeric score for each course, counts its
credits once, and computes sum(score × credits) / sum(graded credits). PT001IU/PT002IU
and zero-credit courses are excluded. Zero is a real score; null is ungraded. No graded
credits returns null rather than zero. Precision is preserved so display rounding cannot
change eligibility at 70. Unknown courses and invalid scores/credits are rejected.

Twenty-one calculator tests cover hand-computed weighted retakes and boundary cases.
Storage and authenticated APIs are the next increments. The existing manual GPA-path
toggle is not yet driven by the new numeric summary, and legacy profile GPA remains on
its old scale until the grade dashboard is activated.

# External prerequisite requirements in the reference read

`GET /api/curricula/:id` used to project member prerequisite edges only. A programme whose documents
name a course it does not offer therefore read back with fewer requirements than it stores — IT Network
Engineering reported thirty where thirty-five exist. The requirements were enforced and invisible,
which is the worst of both: a student could be refused for something the screen never mentioned.

The response now carries a separate `externalPrerequisites` array. It is separate rather than merged
because the two are different kinds of fact: a member edge names a `prerequisiteId` that resolves to a
course in `courses`, and an external edge names a course code with no member identity. Merging them
would force `prerequisiteId` to be nullable and every consumer to re-learn what null means — the shape
that made the first enforcement attempt dishonest.

## What each layer does

| Layer    | Change                                                                                                     |
| -------- | ---------------------------------------------------------------------------------------------------------- |
| contract | `externalPrerequisites: { id, courseId, prerequisiteCode, kind, alternativeGroup }[]`                      |
| schema   | strict, IU-shaped code, `kind` limited to `TQ`/`HT`/`SH`, group nullable                                   |
| reader   | projects both branches; the stored label is narrowed to the published union, unknown labels read as `null` |
| view     | appends the external code to the course's prerequisite line, marked _from another programme_               |

The member branch keeps its own shape exactly, so nothing that consumed `prerequisites` changes.

## What the view says

A course whose requirement comes from outside reads _"Prerequisites: IT149IU (from another
programme)"_ beside any member prerequisites. The marker is not decoration: an external code is a real
requirement that this programme's own course list cannot satisfy, and a reader who cannot tell them
apart will assume the list is wrong.

## Verification

IT Network Engineering is the first curriculum with both branches: 30 member edges and 5 external
ones, every external edge carrying an alternative group. A case imports the committed manifest, reads
it through the same function the route calls, and asserts both counts and the exact codes.

119 server suites / 3,076 tests and the full client suite pass, with build, typecheck and zero-warning
lint. One `curriculumRecommendations` case failed once inside a batched run and passed alone and in
the full run afterwards; it joins the recorded intermittent findings rather than being explained away.

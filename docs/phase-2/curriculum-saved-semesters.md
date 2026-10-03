# Curriculum-consistent saved semesters

Semester creation and course-list updates validate placed membership in the plan
owner's stored curriculum and calculate cached totals from its rating prior. The
owner is used even when an administrator with a different curriculum performs the
write. Unassigned owners retain the global prior. Order and positions round-trip;
credits remain authoritative and planned physical-training credits are included.

Authorization, the current owner context, nested-semester lookup, course identity,
membership, rating evidence, prior, calculated totals and the write share one
Serializable transaction. Serialization failures retry up to five attempts and
then return 409. Same-slot uniqueness conflicts also return 409. The service
rechecks the current actor role and owner/nested-resource access even after the
route middleware's earlier checks.

The existing strict route validation rejects malformed/duplicate IDs after UUID
normalization. Missing global courses retain 400 validation details. Nonmember or
unplaced courses return 409. Failures leave the entire list, totals and metadata
unchanged. An explicit empty list remains valid and saves zero totals without
inventing a prior for an empty curriculum.

Metadata-only edits preserve historical course lists and cached totals after
ratings or context changes. A course-list save is the explicit recalculation point
and must satisfy current membership, even when the submitted list is unchanged.
Read APIs continue returning cached values; they do not rewrite history.

This does not validate prerequisite scheduling, GPA placement choice, elective
requirements, course offerings, timetable conflicts or teaching resources. No
assignment or selector is enabled. Future assignment must review historical plans
and completion claims rather than silently transferring them. Context scheduling
still needs elective/free-elective handling before a completion estimate is sound.

Fourteen new real-PostgreSQL cases cover owner-context priors, global vote evidence,
atomic rejection, metadata preservation, admin/nested authorization, duplicate
normalization, empty/unassigned contexts and concurrent create/update operations.
With legacy semester/rating/access regressions, all 60 focused cases pass. Final
review was inline after the earlier agent thread limit.

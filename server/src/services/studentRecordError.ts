export class StudentRecordError extends Error {
  constructor(
    message: string,
    readonly status: 404 | 409,
    readonly details?: { id: string; code: string; name: string }[],
  ) {
    super(message);
  }
}

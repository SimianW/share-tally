// Frozen benchmark baseline from commit 16509935cb34d505ee8d48c5616c2a22ff908e2f (#48).
// Intentional snapshot: do not update when production behavior changes. No secrets or recordings.
export class BillError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

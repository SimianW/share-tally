import type { ItemConflicts } from '@share-tally/domain/contracts/bills';
export class BillApiError extends Error {
  status: number;
  conflicts?: ItemConflicts;
  constructor(status: number, message: string, conflicts?: ItemConflicts) {
    super(message);
    this.status = status;
    this.conflicts = conflicts;
  }
}

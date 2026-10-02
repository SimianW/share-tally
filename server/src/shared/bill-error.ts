import type { ItemConflicts } from '@share-tally/domain/contracts/bills';
export type { ItemConflicts } from '@share-tally/domain/contracts/bills';

export class BillError extends Error {
  constructor(
    public status: number,
    message: string,
    public conflicts?: ItemConflicts,
  ) {
    super(message);
  }
}

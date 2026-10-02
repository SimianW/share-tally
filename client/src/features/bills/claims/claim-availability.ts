import type { BillItem } from '@share-tally/domain/contracts/receipts';
import { one, subtract, sum } from '../../../shared/fractions';

export function claimedByOthers(item: BillItem, ownId: string | undefined) {
  return sum(item.claims.filter(claim => claim.userId !== ownId));
}

/** Confirmed portions and reservations both occupy an item. Own portions remain editable. */
export function roomFor(item: BillItem, ownId: string | undefined) {
  return subtract(one, claimedByOthers(item, ownId));
}

export function unclaimedPortion(item: BillItem) {
  return subtract(one, sum(item.claims));
}

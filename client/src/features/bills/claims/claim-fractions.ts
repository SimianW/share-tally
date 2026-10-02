import { type Bill } from "@share-tally/domain/contracts/bills";
import type { BillItem } from "@share-tally/domain/contracts/receipts";
import { roundedCost } from '@share-tally/domain/fractions';
import { lessOrEqual, parse, text } from '../../../shared/fractions';
import { signedMoney } from "../../../shared/money";
import { roomFor } from './claim-availability';
export function share(items: BillItem[], selection: Record<string, string>) {
  return roundedCost(items.flatMap(item => {
    const f = parse(selection[item.id] ?? '');
    return f ? [{ numerator: Number(f.n), denominator: Number(f.d), finalCents: item.finalCents }] : [];
  }));
}
export function signed(cents: number) { return signedMoney(cents); }

export function claimAvailabilityMessage(bill: Bill, selection: Record<string, string>) {
  const own = bill.participants.find((p) => p.isCurrentUser);
  for (const item of bill.items ?? []) {
    const chosen = parse(selection[item.id] ?? "");
    if (!chosen) continue;
    const room = roomFor(item, own?.userId);
    if (!lessOrEqual(chosen, room)) return `Not enough of ${item.name} is available. Only ${text(room)} is currently available to you. Other confirmed or reserved claims already hold that portion.`;
  }
  return null;
}

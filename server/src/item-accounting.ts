import { and, eq, inArray } from "drizzle-orm";
import { db } from "./db/index.js";
import {
  billItems,
  itemClaims,
  billShares,
  bills,
  receiptDrafts,
  receiptPhotos,
} from "./db/schema.js";
import { roundedCost, sumFractions } from "./fractions.js";
import { BillError } from "./bill-error.js";
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function itemDetails(tx: Tx, billId: string) {
  const items = await tx
    .select()
    .from(billItems)
    .where(eq(billItems.billId, billId))
    .orderBy(billItems.position, billItems.id);
  const claims = items.length
    ? await tx
        .select()
        .from(itemClaims)
        .where(
          inArray(
            itemClaims.itemId,
            items.map((i) => i.id),
          ),
        )
    : [];
  const [photo] = await tx
    .select({ expiresAt: receiptPhotos.expiresAt, draftId: receiptDrafts.id })
    .from(receiptDrafts)
    .innerJoin(receiptPhotos, eq(receiptPhotos.draftId, receiptDrafts.id))
    .where(eq(receiptDrafts.billId, billId));
  return {
    items: items.map((item) => ({
      ...item,
      allocatedTaxCents: item.taxCents,
      allocatedExtraCents: item.extraCents,
      // Legacy items predate receipt summaries: their stored tax and extra
      // are known, but the receipt discount share and manual provenance are not.
      claims: claims.filter((c) => c.itemId === item.id),
    })),
    photo: photo ? { ...photo, expired: photo.expiresAt <= new Date() } : null,
  };
}
export async function recalculateItemBill(
  tx: Tx,
  bill: typeof bills.$inferSelect,
) {
  const { items } = await itemDetails(tx, bill.id);
  const shares = await tx
    .select()
    .from(billShares)
    .where(eq(billShares.billId, bill.id));
  for (const share of shares) {
    const own = items.flatMap((item) =>
      item.claims
        .filter((c) => c.userId === share.userId && c.confirmedAt)
        .map((c) => ({ ...c, finalCents: item.finalCents })),
    );
    const amount = roundedCost(own);
    if (amount > 1_000_000)
      throw new BillError(
        400,
        "A personal share cannot exceed CAD 10,000. Correct the item costs.",
      );
    // Missing remains distinct from an explicit zero, including after adding a participant.
    const amountCents =
      share.amountCents === null && !own.length && !share.confirmedAt
        ? null
        : amount;
    await tx
      .update(billShares)
      .set({ amountCents })
      .where(
        and(
          eq(billShares.billId, bill.id),
          eq(billShares.userId, share.userId),
        ),
      );
    share.amountCents = amountCents;
  }
  if (
    !items.length ||
    shares.some((s) => !s.confirmedAt || s.amountCents === null)
  )
    return;
  if (
    items.some((item) => {
      const sum = sumFractions(item.claims.filter((c) => c.confirmedAt));
      return sum.n !== sum.d;
    })
  )
    return;
  const sum = shares.reduce((n, s) => n + s.amountCents!, 0);
  const adjustmentCents = bill.totalCents - sum;
  const initiator = shares.find((s) => s.userId === bill.initiatorId)!;
  if (initiator.amountCents! + adjustmentCents < 0) return;
  await tx
    .update(bills)
    .set({ completedAt: new Date(), adjustmentCents })
    .where(eq(bills.id, bill.id));
}

import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db/index.js";
import {
  bills,
  billItems,
  itemClaims,
  billShares,
  groupMembers,
} from "./db/schema.js";
import { BillError } from "./bill-error.js";
import {
  checked,
  claimInput,
  itemInput,
  revisionInput,
} from "./receipt-input.js";
import { correctedPrice } from "./frozen-receipt-pricing.js";
import {
  itemDetails,
  recalculateItemBill,
  type Tx,
} from "./item-accounting.js";
import { sumFractions } from "./fractions.js";
import { notifyGroupChanged } from "./group-events.js";

async function locked(tx: Tx, id: string, userId: string) {
  const [bill] = await tx
    .select()
    .from(bills)
    .where(eq(bills.id, id))
    .for("update");
  if (!bill) throw new BillError(404, "Bill not found.");
  const [member] = await tx
    .select()
    .from(groupMembers)
    .where(
      and(
        eq(groupMembers.groupId, bill.groupId),
        eq(groupMembers.userId, userId),
      ),
    );
  if (!member) throw new BillError(404, "Bill not found.");
  if (bill.mode !== "items")
    throw new BillError(400, "This bill uses manual shares.");
  return bill;
}
function mutable(bill: typeof bills.$inferSelect, revision: number) {
  if (bill.completedAt || bill.canceledAt)
    throw new BillError(409, "This bill is final.");
  if (bill.revision !== revision)
    throw new BillError(
      409,
      "This bill changed. Review the latest items before confirming. Your selections have not been submitted.",
    );
}
export async function confirmClaims(id: string, userId: string, body: unknown) {
  const input = checked(claimInput, body);
  if (
    new Set(input.claims.map((c) => c.itemId)).size !== input.claims.length ||
    input.claims.some((c) => c.numerator > c.denominator)
  )
    throw new BillError(
      400,
      "Choose each item once with a fraction no greater than 1.",
    );
  const groupId = await db.transaction(async (tx) => {
    const bill = await locked(tx, id, userId);
    const [share] = await tx
      .select()
      .from(billShares)
      .where(and(eq(billShares.billId, id), eq(billShares.userId, userId)));
    if (!share)
      throw new BillError(403, "Only selected participants can claim items.");
    const { items } = await itemDetails(tx, id);
    const previous = items.flatMap((i) =>
      i.claims.filter((c) => c.userId === userId),
    );
    // Identical retries have no financial effect, including a response lost at completion.
    if (
      !bill.canceledAt &&
      share.confirmedAt &&
      previous.length === input.claims.length &&
      previous.every(
        (p) =>
          p.confirmedAt &&
          input.claims.some(
            (c) =>
              c.itemId === p.itemId &&
              c.numerator === p.numerator &&
              c.denominator === p.denominator,
          ),
      )
    )
      return bill.groupId;
    mutable(bill, input.revision);
    for (const claim of input.claims) {
      const item = items.find((i) => i.id === claim.itemId);
      if (!item) throw new BillError(400, "An item is no longer on this bill.");
      const allocated = sumFractions([
        ...item.claims.filter((c) => c.userId !== userId),
        claim,
      ]);
      if (allocated.n > allocated.d)
        throw new BillError(
          409,
          `Not enough of ${item.name} is available. Other confirmed or reserved claims already hold that portion.`,
        );
    }
    if (items.length)
      await tx.delete(itemClaims).where(
        and(
          inArray(
            itemClaims.itemId,
            items.map((i) => i.id),
          ),
          eq(itemClaims.userId, userId),
        ),
      );
    if (input.claims.length)
      await tx
        .insert(itemClaims)
        .values(
          input.claims.map((c) => ({ ...c, userId, confirmedAt: new Date() })),
        );
    await tx
      .update(billShares)
      .set({ confirmedAt: new Date(), amountCents: 0 })
      .where(and(eq(billShares.billId, id), eq(billShares.userId, userId)));
    await tx
      .update(bills)
      .set({ revision: bill.revision + 1 })
      .where(eq(bills.id, id));
    await recalculateItemBill(tx, bill);
    return bill.groupId;
  });
  notifyGroupChanged(groupId);
}
export async function correctItem(id: string, itemId: string, userId: string, body: unknown) {
  const input = checked(z.object({
    revision: revisionInput,
    name: z.string().trim().min(1).max(160),
    quantity: z.string().max(40),
    amountCents: z.number().int().min(0).max(1_000_000),
    discountCents: z.number().int().min(0).max(1_000_000),
    taxable: z.boolean(),
    manualFinal: z.boolean(),
    finalCents: z.number().int().min(0).max(1_000_000).optional(),
  }).strict(), body);
  const groupId = await db.transaction(async (tx) => {
    const bill = await locked(tx, id, userId);
    if (bill.initiatorId !== userId)
      throw new BillError(403, "Only the initiator can correct items.");
    mutable(bill, input.revision);
    if (!bill.receipt) throw new BillError(400, "This bill has no stored receipt summary. Use the legacy item editor.");
    const { items } = await itemDetails(tx, id);
    const old = items.find(item => item.id === itemId);
    if (!old) throw new BillError(404, "Item not found.");
    if (input.manualFinal && input.finalCents === undefined)
      throw new BillError(400, "Enter a manual final cost.");
    const next = correctedPrice(bill, old, input);
    if (items.reduce((sum, item) => sum + (item.id === itemId ? next.finalCents : item.finalCents), 0) > 1_000_000)
      throw new BillError(400, "The item total cannot exceed CAD 10,000.");
    if (old.finalCents !== next.finalCents) {
      await tx.update(itemClaims).set({ confirmedAt: null }).where(eq(itemClaims.itemId, itemId));
      const claimants = old.claims.map(claim => claim.userId);
      if (claimants.length)
        await tx.update(billShares).set({ confirmedAt: null })
          .where(and(eq(billShares.billId, id), inArray(billShares.userId, claimants)));
    }
    await tx.update(billItems).set({ ...next, name: input.name, quantity: input.quantity,
      amountCents: input.amountCents, discountCents: input.discountCents })
      .where(eq(billItems.id, itemId));
    await tx.update(bills).set({ revision: bill.revision + 1 }).where(eq(bills.id, id));
    await recalculateItemBill(tx, bill);
    return bill.groupId;
  });
  notifyGroupChanged(groupId);
}

export async function editItems(id: string, userId: string, body: unknown) {
  const input = checked(
    z
      .object({
        revision: revisionInput,
        // No default: omitted historical provenance stays unknown, while a
        // newly chosen override (or return to calculation) records its intent.
        items: z.array(itemInput.extend({ manualFinal: z.boolean().nullable().optional() })).min(1).max(200),
      })
      .strict(),
    body,
  );
  if (new Set(input.items.map((i) => i.id)).size !== input.items.length)
    throw new BillError(400, "Items must have unique IDs.");
  if (input.items.reduce((sum, i) => sum + i.finalCents, 0) > 1_000_000)
    throw new BillError(400, "The item total cannot exceed CAD 10,000.");
  const groupId = await db.transaction(async (tx) => {
    const bill = await locked(tx, id, userId);
    if (bill.initiatorId !== userId)
      throw new BillError(403, "Only the initiator can edit items.");
    mutable(bill, input.revision);
    if (bill.receipt) throw new BillError(409, "Correct one item at a time with the receipt correction endpoint.");
    const { items: previous } = await itemDetails(tx, id);
    const invalidate = new Set<string>();
    for (const old of previous) {
      if (!input.items.some((i) => i.id === old.id)) {
        old.claims.forEach((c) => invalidate.add(c.userId));
        await tx.delete(billItems).where(eq(billItems.id, old.id));
      }
    }
    let added = false;
    for (const [position, item] of input.items.entries()) {
      const old = previous.find((i) => i.id === item.id);
      if (old) {
        // OCR source text is immutable once the bill is initialized.
        if (old.originalText !== item.originalText)
          throw new BillError(
            400,
            "Original OCR text cannot be changed after initialization.",
          );
        if (old.finalCents !== item.finalCents) {
          old.claims.forEach((c) => invalidate.add(c.userId));
          await tx
            .update(itemClaims)
            .set({ confirmedAt: null })
            .where(eq(itemClaims.itemId, item.id));
        }
        await tx
          .update(billItems)
          .set({ ...item, position })
          .where(eq(billItems.id, item.id));
      } else {
        added = true;
        const inserted = await tx
          .insert(billItems)
          .values({ ...item, billId: id, position })
          .onConflictDoNothing()
          .returning();
        if (!inserted.length)
          throw new BillError(
            409,
            "An item ID was already used. Add the item again.",
          );
      }
    }
    if (added) {
      const shares = await tx
        .select()
        .from(billShares)
        .where(eq(billShares.billId, id));
      for (const share of shares)
        if (
          !previous.some((i) => i.claims.some((c) => c.userId === share.userId))
        )
          invalidate.add(share.userId);
    }
    if (invalidate.size)
      await tx
        .update(billShares)
        .set({ confirmedAt: null })
        .where(
          and(
            eq(billShares.billId, id),
            inArray(billShares.userId, [...invalidate]),
          ),
        );
    await tx
      .update(bills)
      .set({ revision: bill.revision + 1 })
      .where(eq(bills.id, id));
    await recalculateItemBill(tx, bill);
    return bill.groupId;
  });
  notifyGroupChanged(groupId);
}

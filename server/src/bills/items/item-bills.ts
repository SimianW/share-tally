import { fraction, sumFractions } from '@share-tally/domain/fractions';
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/index.js";
import { billItems, bills, billShares, itemClaims, } from "../../db/schema.js";
import type { Transaction as Tx } from "../../db/types.js";
import { notifyGroupChanged } from "../../realtime/group-events.js";
import { correctedPrice } from "../../receipts/pricing/frozen-receipt-pricing.js";
import { checked, claimInput, itemInput, reviewedItemsInput, } from "../../receipts/receipt-input.js";
import { BillError, type ItemConflicts } from "../../shared/bill-error.js";
import { lockedBill } from '../access.js';
import { itemDetails, recalculateItemBill } from "./item-accounting.js";

async function locked(tx: Tx, id: string, userId: string) {
  const bill = await lockedBill(tx, id, userId);
  if (bill.mode !== "items")
    throw new BillError(400, "This bill uses manual shares.");
  return bill;
}
function mutable(bill: typeof bills.$inferSelect) {
  if (bill.completedAt || bill.canceledAt)
    throw new BillError(409, "This bill is final.");
}
function staleItems(
  items: { id: string; version: number; name: string; finalCents: number }[],
  reviewed: { itemId: string; version: number }[],
  selected: string[],
): ItemConflicts["stale"] {
  const versions = new Map(reviewed.map(item => [item.itemId, item.version]));
  const selectedIds = new Set(selected);
  const stale: ItemConflicts["stale"] = [];
  for (const item of items) {
    if (!versions.has(item.id)) stale.push({ itemId: item.id, kind: "added" });
    else if (selectedIds.has(item.id) && versions.get(item.id) !== item.version)
      stale.push({ itemId: item.id, kind: "changed", finalCents: item.finalCents, name: item.name });
  }
  const currentIds = new Set(items.map(item => item.id));
  for (const itemId of selectedIds)
    if (!currentIds.has(itemId)) stale.push({ itemId, kind: "removed" });
  return stale;
}

// Versions are the bill revision that last created or changed the item, so an
// item re-added under a removed id never matches a review of the removed one.
function nextVersion(bill: typeof bills.$inferSelect) {
  return bill.revision + 1;
}

// Both initiated-item editors use the same comparison at write time. Derivation
// changes alone do not advance a version; their resulting final cost does.
async function writeItem(
  tx: Tx,
  bill: typeof bills.$inferSelect,
  old: typeof billItems.$inferSelect,
  next: Partial<typeof billItems.$inferInsert> & { name: string; finalCents: number },
) {
  const changed = old.finalCents !== next.finalCents || old.name !== next.name;
  await tx.update(billItems).set({ ...next, version: changed ? nextVersion(bill) : old.version })
    .where(eq(billItems.id, old.id));
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
    const { items } = await itemDetails(tx, bill.id);
    const stale = staleItems(items, input.reviewedItems, input.claims.map(claim => claim.itemId));
    const previous = items.flatMap((i) =>
      i.claims.filter((c) => c.userId === userId),
    );
    // Identical retries have no financial effect, including a response lost at completion.
    if (
      !bill.canceledAt &&
      !stale.length &&
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
    mutable(bill);
    const conflicts: ItemConflicts = { stale, overAllocated: [] };
    for (const claim of input.claims) {
      const item = items.find((i) => i.id === claim.itemId);
      if (!item) continue;
      const others = sumFractions(item.claims.filter((c) => c.userId !== userId));
      if (others.n * BigInt(claim.denominator) + BigInt(claim.numerator) * others.d > others.d * BigInt(claim.denominator)) {
        const available = fraction(others.d - others.n, others.d);
        conflicts.overAllocated.push({ itemId: item.id, available: {
          numerator: available.n.toString(), denominator: available.d.toString(),
        } });
      }
    }
    if (conflicts.stale.length || conflicts.overAllocated.length)
      throw new BillError(409, "The selected items changed or not enough is available. Review the latest items before confirming. Your selections have not been submitted.", conflicts);
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
    version: z.number().int().positive(),
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
    mutable(bill);
    if (!bill.receipt) throw new BillError(400, "This bill has no stored receipt summary. Use the legacy item editor.");
    const { items } = await itemDetails(tx, bill.id);
    const old = items.find(item => item.id === itemId);
    if (!old) throw new BillError(409, "This item was removed.", {
      stale: [{ itemId, kind: "removed" }], overAllocated: [],
    });
    if (old.version !== input.version)
      throw new BillError(409, "This item changed. Review it before correcting it.", {
        stale: [{ itemId, kind: "changed", finalCents: old.finalCents, name: old.name }], overAllocated: [],
      });
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
    await writeItem(tx, bill, old, { ...next, name: input.name, quantity: input.quantity,
      amountCents: input.amountCents, discountCents: input.discountCents });
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
        reviewedItems: reviewedItemsInput,
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
    mutable(bill);
    if (bill.receipt) throw new BillError(409, "Correct one item at a time with the receipt correction endpoint.");
    const { items: previous } = await itemDetails(tx, bill.id);
    const stale = staleItems(previous, input.reviewedItems, input.reviewedItems.map(item => item.itemId));
    if (stale.length)
      throw new BillError(409, "These items changed. Review the latest items before correcting them.", { stale, overAllocated: [] });
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
        await writeItem(tx, bill, old, { ...item, position });
      } else {
        added = true;
        const inserted = await tx
          .insert(billItems)
          .values({ ...item, billId: id, position, version: nextVersion(bill) })
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

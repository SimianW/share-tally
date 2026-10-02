import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { billItems, bills, billShares, groupMembers, itemClaims } from "../db/schema.js";
import type { Transaction as Tx } from '../db/types.js';
import { lockGroupForMember } from '../groups/group-access.js';
import { notifyGroupChanged } from '../realtime/group-events.js';
import { cents } from "../shared/input-validation.js";
import { lockedBill } from './access.js';
import type { parseBill, parseEdit, parseShare } from './inputs.js';
import { recalculateItemBill } from './items/item-accounting.js';
import { BillError } from "../shared/bill-error.js";

async function complete(tx: Tx, bill: typeof bills.$inferSelect) {
  const shares = await tx
    .select()
    .from(billShares)
    .where(eq(billShares.billId, bill.id));
  if (
    bill.canceledAt ||
    shares.some(
      (share) => share.amountCents === null || share.confirmedAt === null,
    )
  )
    return;
  const sum = shares.reduce((n, share) => n + BigInt(share.amountCents!), 0n);
  const difference = BigInt(bill.totalCents) - sum;
  const initiator = shares.find((share) => share.userId === bill.initiatorId)!;
  if (
    difference >= -5n &&
    difference <= 5n &&
    BigInt(initiator.amountCents!) + difference >= 0n
  ) {
    await tx
      .update(bills)
      .set({ adjustmentCents: Number(difference), completedAt: new Date() })
      .where(eq(bills.id, bill.id));
  }
}
export async function createBill(
  groupId: string,
  userId: string,
  input: ReturnType<typeof parseBill>,
) {
  const id = await db.transaction(async (tx) => {
    // Serialize creation with membership changes and other creations in this group.
    await lockGroupForMember(tx, groupId, userId);
    const payload = JSON.stringify({ groupId, ...input });
    const [existing] = await tx
      .select()
      .from(bills)
      .where(
        and(
          eq(bills.initiatorId, userId),
          eq(bills.requestId, input.requestId),
        ),
      );
    if (existing) {
      if (existing.requestPayload !== payload)
        throw new BillError(
          409,
          "This creation request was already used with different details.",
        );
      return existing.id;
    }
    if (!input.participantIds.includes(userId))
      throw new BillError(400, "The initiator must be a participant.");
    const members = await tx
      .select()
      .from(groupMembers)
      .where(eq(groupMembers.groupId, groupId));
    if (
      input.participantIds.some((id) => !members.some((m) => m.userId === id))
    )
      throw new BillError(400, "Every participant must belong to this group.");
    const [bill] = await tx
      .insert(bills)
      .values({
        groupId,
        initiatorId: userId,
        requestId: input.requestId,
        requestPayload: payload,
        title: input.title,
        purchaseDate: input.purchaseDate,
        notes: input.notes,
        totalCents: input.totalCents,
      })
      .onConflictDoNothing()
      .returning();
    if (!bill)
      throw new BillError(
        409,
        "This creation request was already used in another group.",
      );
    await tx.insert(billShares).values(
      input.participantIds.map((id) => ({
        billId: bill.id,
        userId: id,
        amountCents: null,
        confirmedAt: null,
      })),
    );
    return bill.id;
  });
  notifyGroupChanged(groupId);
  return id;
}
function assertMutableRevision(
  bill: typeof bills.$inferSelect,
  revision: number,
) {
  if (bill.revision !== revision)
    throw new BillError(
      409,
      "This bill changed. Review the latest bill before trying again.",
    );
  if (bill.canceledAt) throw new BillError(409, "This bill is canceled.");
}
async function clearConfirmations(tx: Tx, id: string) {
  await tx
    .update(billShares)
    .set({ confirmedAt: null })
    .where(eq(billShares.billId, id));
}
export async function changeBill(
  id: string,
  userId: string,
  command:
    | { action: "edit"; input: ReturnType<typeof parseEdit> }
    | { action: "cancel"; revision: number },
) {
  const { action } = command;
  const input = command.action === "edit" ? command.input : undefined;
  const revision =
    command.action === "edit" ? command.input.revision : command.revision;
  const groupId = await db.transaction(async (tx) => {
    const bill = await lockedBill(tx, id, userId);
    if (bill.initiatorId !== userId)
      throw new BillError(403, "Only the initiator can change this bill.");
    assertMutableRevision(bill, revision);
    if (bill.completedAt)
      throw new BillError(409, "Completed bills are final and cannot be changed.");
    if (action === "cancel") {
      await tx
        .update(bills)
        .set({ canceledAt: new Date(), revision: bill.revision + 1 })
        .where(eq(bills.id, id));
      return bill.groupId;
    }
    if (input) {
      if (!input.participantIds.includes(userId))
        throw new BillError(400, "The initiator must remain a participant.");
      const members = await tx
        .select()
        .from(groupMembers)
        .where(eq(groupMembers.groupId, bill.groupId));
      if (
        input.participantIds.some((id) => !members.some((m) => m.userId === id))
      )
        throw new BillError(
          400,
          "Every participant must belong to this group.",
        );
      const shares = await tx
        .select()
        .from(billShares)
        .where(eq(billShares.billId, id));
      if (bill.mode === 'items') {
        const items = await tx.select().from(billItems).where(eq(billItems.billId, id));
        if (items.length) {
          const itemIds = items.map(i => i.id);
          for (const share of shares) if (!input.participantIds.includes(share.userId))
            await tx.delete(itemClaims).where(and(inArray(itemClaims.itemId, itemIds), eq(itemClaims.userId, share.userId)));
          await tx.update(itemClaims).set({ confirmedAt: null }).where(inArray(itemClaims.itemId, itemIds));
        }
      }
      for (const share of shares)
        if (!input.participantIds.includes(share.userId))
          await tx
            .delete(billShares)
            .where(
              and(
                eq(billShares.billId, id),
                eq(billShares.userId, share.userId),
              ),
            );
      for (const userId of input.participantIds)
        if (!shares.some((s) => s.userId === userId))
          await tx.insert(billShares).values({ billId: id, userId });
    }
    // Manual confirmations cover only their owner's share, so only a new total voids them (ADR-0015).
    const keepConfirmations = bill.mode !== 'items' && input?.totalCents === bill.totalCents;
    if (!keepConfirmations) await clearConfirmations(tx, id);
    await tx
      .update(bills)
      .set({
        ...(input
          ? {
              title: input.title,
              notes: input.notes,
              purchaseDate: input.purchaseDate,
              totalCents: input.totalCents,
            }
          : {}),
        completedAt: null,
        adjustmentCents: null,
        revision: bill.revision + 1,
      })
      .where(eq(bills.id, id));
    if (bill.mode === 'items') await recalculateItemBill(tx, { ...bill, totalCents: input?.totalCents ?? bill.totalCents, completedAt: null });
    if (keepConfirmations) await complete(tx, bill);
    return bill.groupId;
  });
  notifyGroupChanged(groupId);
}
export async function submitShare(
  id: string,
  userId: string,
  input: ReturnType<typeof parseShare>,
) {
  const groupId = await db.transaction(async (tx) => {
    const bill = await lockedBill(tx, id, userId);
    const [share] = await tx
      .select()
      .from(billShares)
      .where(and(eq(billShares.billId, id), eq(billShares.userId, userId)));
    if (!share)
      throw new BillError(
        403,
        "Only selected participants can submit a share.",
      );
    if (bill.mode === 'items') throw new BillError(400, 'Claim items to calculate your share on this bill.');
    assertMutableRevision(bill, input.revision);
    cents(input.amount, bill.totalCents);
    // An identical retry is harmless, even if this submission just completed the bill.
    if (share.amountCents === input.amount && share.confirmedAt) return bill.groupId;
    if (share.amountCents !== input.expectedAmount)
      throw new BillError(
        409,
        "Your share changed. Review the latest bill before trying again.",
      );
    if (bill.completedAt)
      throw new BillError(
        409,
        "Completed bills are final and cannot be changed.",
      );
    // A share is its owner's debt alone, so saving confirms it without touching other confirmations (ADR-0015).
    await tx
      .update(billShares)
      .set({ amountCents: input.amount, confirmedAt: new Date() })
      .where(and(eq(billShares.billId, id), eq(billShares.userId, userId)));
    await complete(tx, bill);
    return bill.groupId;
  });
  notifyGroupChanged(groupId);
}

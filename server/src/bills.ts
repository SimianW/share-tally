import { itemDetails, recalculateItemBill } from './item-accounting.js';
import { selectFrozenTaxRate } from './frozen-receipt-pricing.js';
import { notifyGroupChanged } from './group-events.js';
import { cents, isUuid } from "./input-validation.js";
export { isUuid } from "./input-validation.js";
import { confirmedRepaymentEntries } from "./repayment-accounting.js";
import { readRepayments, type Repayment } from './repayments.js';
import { and, desc, eq, inArray } from "drizzle-orm";
import { safeCents } from "./money.js";
import { groupLedger } from "./group-ledger.js";
import { db } from "./db/index.js";
import { bills, billShares, groupMembers, groups, users, billItems, itemClaims } from "./db/schema.js";

import { BillError } from "./bill-error.js";
export { BillError } from "./bill-error.js";

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new BillError(400, "Expected a JSON object.");
  return value as Record<string, unknown>;
}
export function parseRevision(value: unknown) {
  const body = object(value);
  if (!Number.isSafeInteger(body.revision) || Number(body.revision) < 1)
    throw new BillError(400, "A positive bill revision is required.");
  return Number(body.revision);
}
export function parseAction(value: unknown) {
  const body = object(value);
  if (Object.keys(body).some((key) => key !== "revision"))
    throw new BillError(400, "Unexpected action field.");
  return parseRevision(body);
}
export function parseShare(value: unknown) {
  const body = object(value);
  if (
    Object.keys(body).some(
      (key) =>
        !["amountCents", "expectedAmountCents", "revision"].includes(key),
    )
  )
    throw new BillError(400, "Submit only your own share.");
  return {
    amount: cents(body.amountCents),
    revision: parseRevision(body),
    expectedAmount:
      body.expectedAmountCents === null
        ? null
        : cents(body.expectedAmountCents),
  };
}
export function parseEdit(value: unknown) {
  const body = object(value);
  const revision = parseRevision(body);
  const { revision: _, ...details } = body;
  if ("requestId" in details || "ownShareCents" in details)
    throw new BillError(400, "Bill edits cannot change participant amounts.");
  const {
    requestId: _request,
    ownShareCents: _share,
    ...input
  } = parseBill({
    ...details,
    requestId: "00000000-0000-4000-8000-000000000000",
    ownShareCents: 0,
  });
  return { ...input, revision };
}
export function parseBill(value: unknown) {
  const body = object(value);
  const allowed = [
    "requestId",
    "title",
    "purchaseDate",
    "timeZone",
    "notes",
    "totalCents",
    "ownShareCents",
    "participantIds",
  ];
  if (Object.keys(body).some((key) => !allowed.includes(key)))
    throw new BillError(400, "Unexpected bill field.");
  if (!isUuid(body.requestId))
    throw new BillError(400, "A UUID requestId is required.");
  if (
    typeof body.title !== "string" ||
    !body.title.trim() ||
    [...body.title.trim()].length > 120 ||
    /\p{Cc}/u.test(body.title)
  )
    throw new BillError(
      400,
      "Title must contain 1 to 120 characters without control characters.",
    );
  const notes = body.notes ?? "";
  if (
    typeof notes !== "string" ||
    [...notes].length > 2000 ||
    notes.includes("\0")
  )
    throw new BillError(400, "Notes must contain at most 2,000 characters.");
  if (
    typeof body.purchaseDate !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(body.purchaseDate) ||
    body.purchaseDate < "0001-01-01" ||
    !Number.isFinite(Date.parse(body.purchaseDate)) ||
    new Date(body.purchaseDate).toISOString().slice(0, 10) !== body.purchaseDate
  )
    throw new BillError(400, "Enter a valid purchase date.");
  let today: string;
  try {
    if (typeof body.timeZone !== "string") throw new Error();
    today = new Intl.DateTimeFormat("en-CA", {
      timeZone: body.timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  } catch {
    throw new BillError(400, "A valid device time zone is required.");
  }
  if (body.purchaseDate > today)
    throw new BillError(400, "Purchase date cannot be in the future.");
  const totalCents = cents(body.totalCents);
  if (totalCents === 0)
    throw new BillError(400, "Bill total must be positive.");
  if (
    !Array.isArray(body.participantIds) ||
    !body.participantIds.length ||
    !body.participantIds.every(isUuid)
  )
    throw new BillError(400, "Select group participants.");
  const participantIds = body.participantIds
    .map((id) => id.toLowerCase())
    .sort();
  if (new Set(participantIds).size !== participantIds.length)
    throw new BillError(400, "Participants must be unique.");
  return {
    requestId: body.requestId.toLowerCase(),
    title: body.title.trim(),
    purchaseDate: body.purchaseDate,
    notes,
    totalCents,
    ownShareCents: cents(body.ownShareCents, totalCents),
    participantIds,
  };
}
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
async function member(tx: Tx, groupId: string, userId: string) {
  const [row] = await tx
    .select()
    .from(groupMembers)
    .where(
      and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)),
    );
  if (!row) throw new BillError(404, "Group not found.");
}
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
    await tx.select().from(groups).where(eq(groups.id, groupId)).for("update");
    await member(tx, groupId, userId);
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
        amountCents: id === userId ? input.ownShareCents : null,
        confirmedAt: id === userId ? new Date() : null,
      })),
    );
    await complete(tx, bill);
    return bill.id;
  });
  notifyGroupChanged(groupId);
  return id;
}
async function lockedBill(tx: Tx, id: string, userId: string) {
  const [bill] = await tx
    .select()
    .from(bills)
    .where(eq(bills.id, id))
    .for("update");
  if (!bill) throw new BillError(404, "Bill not found.");
  await member(tx, bill.groupId, userId);
  return bill;
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
    await clearConfirmations(tx, id);
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
    const changed =
      share.amountCents !== null && share.amountCents !== input.amount;
    if (changed) {
      await clearConfirmations(tx, id);
      await tx
        .update(bills)
        .set({
          revision: bill.revision + 1,
          adjustmentCents: null,
          completedAt: null,
        })
        .where(eq(bills.id, id));
    }
    await tx
      .update(billShares)
      .set({
        amountCents: input.amount,
        confirmedAt: changed && userId !== bill.initiatorId ? null : new Date(),
      })
      .where(and(eq(billShares.billId, id), eq(billShares.userId, userId)));
    if (!changed || userId === bill.initiatorId) await complete(tx, bill);
    return bill.groupId;
  });
  notifyGroupChanged(groupId);
}
async function readBillsInSnapshot(tx: Tx, userId: string, groupId?: string, id?: string) {
  if (groupId) await member(tx, groupId, userId);
  const rows = await tx
    .select({ bill: bills })
    .from(bills)
    .innerJoin(
      groupMembers,
      and(
        eq(groupMembers.groupId, bills.groupId),
        eq(groupMembers.userId, userId),
      ),
    )
    .where(
      and(
        groupId ? eq(bills.groupId, groupId) : undefined,
        id ? eq(bills.id, id) : undefined,
      ),
    )
    .orderBy(desc(bills.createdAt), bills.id);
  if (id && !rows.length) throw new BillError(404, "Bill not found.");
  if (!rows.length) return [];
  const shares = await tx
    .select({
      userId: billShares.userId,
      billId: billShares.billId,
      amountCents: billShares.amountCents,
      confirmedAt: billShares.confirmedAt,
      displayName: users.displayName,
    })
    .from(billShares)
    .innerJoin(users, eq(users.id, billShares.userId))
    .where(
      inArray(
        billShares.billId,
        rows.map((row) => row.bill.id),
      ),
    )
    .orderBy(users.id);
  return Promise.all(rows.map(async ({ bill }) => {
    const participants = shares
      .filter((s) => s.billId === bill.id)
      .map((s) => ({
        ...s,
        displayName: s.displayName ?? "Member",
        isCurrentUser: s.userId === userId,
      }));
    const submittedCents = safeCents(
      participants.reduce((n, s) => n + BigInt(s.amountCents ?? 0), 0n),
    );
    const details = bill.mode === 'items' ? await itemDetails(tx, bill.id) : null;
    const {
      requestId: _requestId,
      requestPayload: _payload,
      ...fields
    } = bill;
    const { printedTaxRate: _printedRate, ...publicReceipt } = bill.receipt ?? {};
    return {
      ...fields,
      receipt: bill.receipt ? publicReceipt : null,
      frozenTaxRate: bill.receipt
        ? selectFrozenTaxRate(bill.receipt, bill.frozenTaxBaseCents ?? 0) : null,
      ...(details ?? {}),
      participants,
      submittedCents,
      differenceCents: bill.totalCents - submittedCents,
      confirmedCount: participants.filter((s) => s.confirmedAt !== null)
        .length,
    };
  }));
}
export async function readBills(userId: string, groupId?: string, id?: string) {
  return db.transaction(tx => readBillsInSnapshot(tx, userId, groupId, id),
    { isolationLevel: "repeatable read", accessMode: "read only" });
}
export async function readGroupBills(userId: string, groupId: string) {
  return db.transaction(async tx => {
    const rows = await readBillsInSnapshot(tx, userId, groupId);
    const members = await tx.select({ userId: users.id, displayName: users.displayName })
      .from(groupMembers).innerJoin(users, eq(users.id, groupMembers.userId))
      .where(eq(groupMembers.groupId, groupId)).orderBy(users.id);
    const repayments = await readRepayments(tx, userId, groupId);
    return { bills: rows, repayments, summary: summarize(rows, userId, repayments), ledger: groupLedger(rows, members, repayments) };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}
export async function readSummary(userId: string) {
  return db.transaction(async tx => {
    const rows = await readBillsInSnapshot(tx, userId);
    const repayments = await readRepayments(tx, userId);
    return summarize(rows, userId, repayments);
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}
export function summarize(
  rows: Awaited<ReturnType<typeof readBills>>,
  userId: string,
  repayments: Repayment[] = [],
) {
  const balances = new Map<string, bigint>();
  const add = (groupId: string, amount: bigint) => balances.set(groupId, (balances.get(groupId) ?? 0n) + amount);
  for (const bill of rows) {
    if (!bill.completedAt || bill.canceledAt) continue;
    const own = bill.participants.find(p => p.userId === userId);
    if (!own) continue;
    add(bill.groupId, bill.initiatorId === userId
      ? BigInt(bill.totalCents) - BigInt(own.amountCents!) - BigInt(bill.adjustmentCents!)
      : -BigInt(own.amountCents!));
  }
  for (const entry of confirmedRepaymentEntries(repayments)) {
    if (entry.userId === userId) add(entry.groupId, entry.amountCents);
  }
  let receivable = 0n, payable = 0n;
  for (const balance of balances.values()) {
    if (balance > 0n) receivable += balance;
    else payable -= balance;
  }
  return { receivableCents: safeCents(receivable), payableCents: safeCents(payable), netCents: safeCents(receivable - payable) };
}

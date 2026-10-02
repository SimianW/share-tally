import { and, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { db } from "../db/index.js";
import { bills, billShares, groupMembers, groups, users } from "../db/schema.js";
import { requireMember as member } from '../groups/group-access.js';
import { billEffects, counted, groupLedger, repaymentEffects, type BalanceBill } from "../ledger/group-ledger.js";
import { selectFrozenTaxRate } from '../receipts/pricing/frozen-receipt-pricing.js';
import { readRepayments, type Repayment } from '../repayments/repayments.js';
import { safeCents } from "../shared/money.js";
import { itemDetails } from './items/item-accounting.js';
import { BillError } from "../shared/bill-error.js";
import type { Transaction as Tx } from '../db/types.js';
// Source observations stay server-side; expose only the receipt used by the bill.
function receiptForBill(receipt: NonNullable<typeof bills.$inferSelect.receipt>) {
  const { printedTaxRate: _printedRate, ...publicReceipt } = receipt;
  return publicReceipt;
}

export async function readBillsInSnapshot(tx: Tx, userId: string, groupId?: string, id?: string) {
  if (groupId) await member(tx, groupId, userId);
  const rows = await tx
    .select({ bill: bills })
    .from(bills)
    .innerJoin(groups, and(eq(groups.id, bills.groupId), isNull(groups.deletedAt)))
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
    const publicReceipt = bill.receipt ? receiptForBill(bill.receipt) : null;
    return {
      ...fields,
      receipt: publicReceipt,
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
// The member's net balance in each group, from the same per-entry effects as
// the group ledger. The group page and the group list both use this arithmetic.
function memberBalances(rows: (BalanceBill & Pick<typeof bills.$inferSelect, 'groupId' | 'completedAt' | 'canceledAt'>)[],
  userId: string, repayments: Repayment[]) {
  const balances = new Map<string, bigint>();
  const add = (groupId: string, effects: { userId: string; netCents: number }[]) => {
    for (const effect of effects)
      if (effect.userId === userId) balances.set(groupId, (balances.get(groupId) ?? 0n) + BigInt(effect.netCents));
  };
  for (const bill of rows) if (counted(bill)) add(bill.groupId, billEffects(bill));
  for (const record of repayments) add(record.groupId, repaymentEffects(record));
  return balances;
}
// Reads only the member's own shares of completed bills, which is all the
// balance needs, rather than every participant and item of every bill.
export async function readMemberBalancesInSnapshot(tx: Tx, userId: string, groupIds: string[]) {
  if (!groupIds.length) return new Map<string, number>();
  const rows = await tx.select({
    groupId: bills.groupId, initiatorId: bills.initiatorId, totalCents: bills.totalCents,
    adjustmentCents: bills.adjustmentCents, completedAt: bills.completedAt, canceledAt: bills.canceledAt,
    amountCents: billShares.amountCents,
  }).from(bills)
    .innerJoin(billShares, and(eq(billShares.billId, bills.id), eq(billShares.userId, userId)))
    .where(and(inArray(bills.groupId, groupIds), isNotNull(bills.completedAt), isNull(bills.canceledAt)));
  const repayments = (await readRepayments(tx, userId)).filter(repayment => groupIds.includes(repayment.groupId));
  const balances = memberBalances(
    rows.map(({ amountCents, ...bill }) => ({ ...bill, participants: [{ userId, amountCents }] })), userId, repayments);
  return new Map(groupIds.map(id => [id, safeCents(balances.get(id) ?? 0n)]));
}
export function summarize(
  rows: Awaited<ReturnType<typeof readBills>>,
  userId: string,
  repayments: Repayment[] = [],
) {
  const balances = memberBalances(rows, userId, repayments);
  let receivable = 0n, payable = 0n;
  for (const balance of balances.values()) {
    if (balance > 0n) receivable += balance;
    else payable -= balance;
  }
  return { receivableCents: safeCents(receivable), payableCents: safeCents(payable), netCents: safeCents(receivable - payable) };
}

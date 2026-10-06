import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../db/index.js";
import { bills, billShares, groupMembers, groups, users } from "../db/schema.js";
import { requireMember as member } from '../groups/group-access.js';
import { readMemberBalancesInSnapshot } from "../ledger/accounting.js";
import { balanceTotals, groupLedger, memberBalances } from "../ledger/group-ledger.js";
import { selectFrozenTaxRate } from '../receipts/pricing/frozen-receipt-pricing.js';
import { readRepayments } from '../repayments/repayments.js';
import { safeCents } from "../shared/money.js";
import { readItemDetailsInSnapshot } from './items/item-accounting.js';
import { BillError } from "../shared/bill-error.js";
import type { Transaction as Tx } from '../db/types.js';
// Source observations stay server-side; expose only the receipt used by the bill.
function receiptForBill(receipt: NonNullable<typeof bills.$inferSelect.receipt>) {
  const { printedTaxRate: _printedRate, ...publicReceipt } = receipt;
  return publicReceipt;
}

async function readBillsInSnapshot(tx: Tx, userId: string, groupId?: string, id?: string) {
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
  const details = await readItemDetailsInSnapshot(tx,
    rows.filter(({ bill }) => bill.mode === 'items').map(({ bill }) => bill.id));
  return rows.map(({ bill }) => {
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
      ...(details.get(bill.id) ?? {}),
      participants,
      submittedCents,
      differenceCents: bill.totalCents - submittedCents,
      confirmedCount: participants.filter((s) => s.confirmedAt !== null)
        .length,
    };
  });
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
    return { bills: rows, repayments, summary: balanceTotals(memberBalances(rows, userId, repayments)), ledger: groupLedger(rows, members, repayments) };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}
export async function readSummary(userId: string) {
  return db.transaction(async tx => balanceTotals(await readMemberBalancesInSnapshot(tx, userId)),
    { isolationLevel: "repeatable read", accessMode: "read only" });
}

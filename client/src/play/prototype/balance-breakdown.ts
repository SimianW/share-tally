// PROTOTYPE (throwaway): client-side reconstruction of how each ledger figure is
// built from completed bills and confirmed repayments. It mirrors
// server/src/group-ledger.ts for display only; a real version would come from the server.
import type { Bill, Repayment } from '../bill-api';
import type { GroupPageData } from '../group-view';

export type BillLine = {
  kind: 'bill'; key: string; bill: Bill;
  paidCents: number; shareCents: number; adjustmentCents: number; netCents: number;
};
export type RepaymentLine = {
  kind: 'repayment'; key: string; repayment: Repayment; counterpartyId: string; netCents: number;
};
export type Line = BillLine | RepaymentLine;

export type MemberBreakdown = { userId: string; lines: Line[]; totalCents: number; uncounted: Bill[] };

const counted = (bill: Bill) => bill.completedAt !== null && bill.canceledAt === null;
const byDate = (a: Line, b: Line) => date(a).localeCompare(date(b));
export function date(line: Line) { return line.kind === 'bill' ? line.bill.purchaseDate : line.repayment.decidedAt ?? line.repayment.createdAt; }

export function memberBreakdown(data: GroupPageData, userId: string): MemberBreakdown {
  const lines: Line[] = [];
  for (const bill of data.bills) {
    if (!counted(bill)) continue;
    const share = bill.participants.find(participant => participant.userId === userId);
    const isInitiator = bill.initiatorId === userId;
    if (!share && !isInitiator) continue;
    const paidCents = isInitiator ? bill.totalCents : 0;
    const shareCents = share?.amountCents ?? 0;
    const adjustmentCents = isInitiator ? bill.adjustmentCents ?? 0 : 0;
    lines.push({ kind: 'bill', key: bill.id, bill, paidCents, shareCents, adjustmentCents, netCents: paidCents - shareCents - adjustmentCents });
  }
  for (const repayment of data.repayments) {
    if (repayment.status !== 'confirmed') continue;
    if (repayment.senderId === userId) lines.push({ kind: 'repayment', key: repayment.id, repayment, counterpartyId: repayment.recipientId, netCents: repayment.amountCents });
    else if (repayment.recipientId === userId) lines.push({ kind: 'repayment', key: repayment.id, repayment, counterpartyId: repayment.senderId, netCents: -repayment.amountCents });
  }
  lines.sort(byDate);
  return {
    userId, lines,
    totalCents: lines.reduce((sum, line) => sum + line.netCents, 0),
    uncounted: data.bills.filter(bill => !counted(bill) && bill.canceledAt === null &&
      (bill.initiatorId === userId || bill.participants.some(participant => participant.userId === userId))),
  };
}

// What `debtor` owes `creditor` directly, before any simplification. Initiator
// adjustments stay with the initiator, so they never create a debt between two people.
export type PairLine = { key: string; label: string; date: string; bill?: Bill; repayment?: Repayment; cents: number };
export function pairwise(data: GroupPageData, debtorId: string, creditorId: string) {
  const lines: PairLine[] = [];
  for (const bill of data.bills) {
    if (!counted(bill)) continue;
    const shareOf = (id: string) => bill.participants.find(participant => participant.userId === id)?.amountCents ?? 0;
    if (bill.initiatorId === creditorId && shareOf(debtorId)) lines.push({ key: bill.id, label: bill.title, date: bill.purchaseDate, bill, cents: shareOf(debtorId) });
    if (bill.initiatorId === debtorId && shareOf(creditorId)) lines.push({ key: bill.id, label: bill.title, date: bill.purchaseDate, bill, cents: -shareOf(creditorId) });
  }
  for (const repayment of data.repayments) {
    if (repayment.status !== 'confirmed') continue;
    const when = repayment.decidedAt ?? repayment.createdAt;
    if (repayment.senderId === debtorId && repayment.recipientId === creditorId) lines.push({ key: repayment.id, label: 'Repayment', date: when, repayment, cents: -repayment.amountCents });
    if (repayment.senderId === creditorId && repayment.recipientId === debtorId) lines.push({ key: repayment.id, label: 'Repayment', date: when, repayment, cents: repayment.amountCents });
  }
  lines.sort((a, b) => a.date.localeCompare(b.date));
  return { lines, totalCents: lines.reduce((sum, line) => sum + line.cents, 0) };
}

export type Relation = { fromId: string; toId: string; cents: number };
// Every nonzero direct debt in the group, oriented so cents > 0.
export function relations(data: GroupPageData): Relation[] {
  const ids = data.ledger.members.map(member => member.userId);
  const result: Relation[] = [];
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    const cents = pairwise(data, ids[i], ids[j]).totalCents;
    if (cents > 0) result.push({ fromId: ids[i], toId: ids[j], cents });
    if (cents < 0) result.push({ fromId: ids[j], toId: ids[i], cents: -cents });
  }
  return result;
}

export function transferBreakdown(data: GroupPageData, fromId: string, toId: string, amountCents: number) {
  const direct = pairwise(data, fromId, toId);
  // Other direct debts that touch either side: these are what simplification reroutes.
  const others = relations(data).filter(relation =>
    !(relation.fromId === fromId && relation.toId === toId) && !(relation.fromId === toId && relation.toId === fromId) &&
    (relation.fromId === fromId || relation.toId === toId || relation.toId === fromId || relation.fromId === toId));
  const fromNet = data.ledger.members.find(member => member.userId === fromId)?.netCents ?? 0;
  const toNet = data.ledger.members.find(member => member.userId === toId)?.netCents ?? 0;
  const fromSuggestions = data.ledger.suggestions.filter(suggestion => suggestion.fromUserId === fromId);
  const toSuggestions = data.ledger.suggestions.filter(suggestion => suggestion.toUserId === toId);
  return { direct, routedCents: amountCents - direct.totalCents, others, fromNet, toNet, fromSuggestions, toSuggestions };
}
export type TransferBreakdown = ReturnType<typeof transferBreakdown>;

export function withRunning(lines: Line[]) {
  return lines.reduce<{ line: Line; start: number; end: number }[]>((steps, line) => {
    const start = steps.at(-1)?.end ?? 0;
    return [...steps, { line, start, end: start + line.netCents }];
  }, []);
}

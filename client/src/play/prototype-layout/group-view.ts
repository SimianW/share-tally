// PROTOTYPE ONLY (#94): what the redesigned group page shows, derived from the
// data GroupBills already loads. The client only filters and labels server
// amounts; it never computes a balance or a suggestion.
import type { Bill, GroupLedger, Repayment, Summary } from '../bill-api';
import type { GroupDetail } from '../group-api';

export type PageData = { bills: Bill[]; summary: Summary; ledger: GroupLedger; repayments: Repayment[]; group: GroupDetail };

export type DashboardRow = {
  otherId: string;
  otherName: string;
  // pay: you pay them. receive: they pay you. Rows come from server suggestions,
  // or from a pending record with no matching suggestion.
  direction: 'pay' | 'receive';
  suggestedCents: number | null;
  pendingIncoming: Repayment | null;
  pendingOutgoing: Repayment | null;
};

export type BillTodo = 'enter' | 'confirm' | 'claim' | 'confirm-items';
export type OpenBill = { bill: Bill; todo: BillTodo | null; waitingFor: string[] };

export const todoLabel: Record<BillTodo, string> = {
  enter: 'Enter your share',
  confirm: 'Confirm your share',
  claim: 'Claim your items',
  'confirm-items': 'Confirm your items',
};

// Same rule as the Home action list (server/src/attention.ts): the viewer is a
// participant, has not confirmed, and the bill is neither complete nor canceled.
function todoFor(bill: Bill): BillTodo | null {
  const mine = bill.participants.find(participant => participant.isCurrentUser);
  if (!mine || mine.confirmedAt) return null;
  if (bill.mode === 'items') return mine.amountCents === null ? 'claim' : 'confirm-items';
  return mine.amountCents === null ? 'enter' : 'confirm';
}

export function groupView(data: PageData) {
  const me = data.group.members.find(member => member.isCurrentUser)!;
  const name = (id: string) => id === me.id ? 'You' : data.group.members.find(member => member.id === id)?.displayName ?? 'Member';

  const open: OpenBill[] = data.bills.filter(bill => !bill.completedAt && !bill.canceledAt).map(bill => ({
    bill,
    todo: todoFor(bill),
    waitingFor: bill.participants.filter(participant => !participant.confirmedAt && !participant.isCurrentUser).map(participant => participant.displayName),
  }));
  // Bills that need you first; keep the server's newest-first order otherwise.
  open.sort((a, b) => Number(!a.todo) - Number(!b.todo));
  const history = data.bills.filter(bill => bill.completedAt || bill.canceledAt);

  const rows: DashboardRow[] = [];
  const row = (otherId: string, direction: DashboardRow['direction']) => {
    let found = rows.find(candidate => candidate.otherId === otherId && candidate.direction === direction);
    if (!found) {
      found = { otherId, otherName: name(otherId), direction, suggestedCents: null, pendingIncoming: null, pendingOutgoing: null };
      rows.push(found);
    }
    return found;
  };
  for (const suggestion of data.ledger.suggestions) {
    if (suggestion.fromUserId === me.id) row(suggestion.toUserId, 'pay').suggestedCents = suggestion.amountCents;
    if (suggestion.toUserId === me.id) row(suggestion.fromUserId, 'receive').suggestedCents = suggestion.amountCents;
  }
  for (const record of data.repayments.filter(candidate => candidate.status === 'pending')) {
    if (record.recipientId === me.id) row(record.senderId, 'receive').pendingIncoming ??= record;
    if (record.senderId === me.id) row(record.recipientId, 'pay').pendingOutgoing ??= record;
  }
  // What you can act on first: records to review, then transfers you owe.
  const rank = (entry: DashboardRow) => entry.pendingIncoming ? 0 : entry.direction === 'pay' && !entry.pendingOutgoing ? 1 : 2;
  rows.sort((a, b) => rank(a) - rank(b));

  const repayments = [...data.repayments].sort((a, b) =>
    Number(a.status !== 'pending') - Number(b.status !== 'pending') || b.createdAt.localeCompare(a.createdAt));

  return {
    me,
    name,
    netCents: data.summary.netCents,
    rows,
    uncountedBills: data.ledger.incompleteBillIds.length,
    open,
    todoCount: open.filter(entry => entry.todo).length + rows.filter(entry => entry.pendingIncoming).length,
    history,
    members: data.ledger.members,
    suggestions: data.ledger.suggestions,
    repayments,
  };
}

export type GroupView = ReturnType<typeof groupView>;

export function billMeta(bill: Bill, name: (id: string) => string) {
  const confirmed = bill.participants.filter(participant => participant.confirmedAt).length;
  const payer = name(bill.initiatorId);
  return `${bill.purchaseDate} · paid by ${payer === 'You' ? 'you' : payer} · ${confirmed}/${bill.participants.length} confirmed`;
}

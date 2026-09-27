import type { Bill, GroupLedger, Repayment, Summary } from './bill-api';
import type { GroupDetail } from './group-api';

export type GroupPageData = {
  bills: Bill[];
  summary: Summary;
  ledger: GroupLedger;
  repayments: Repayment[];
  group: GroupDetail;
};

type BillTodo = 'Enter your share' | 'Confirm your share' | 'Claim your items' | 'Confirm your items';
export type OpenBill = { bill: Bill; todo: BillTodo | null; waitingFor: string[] };
export type DashboardRow = {
  member: Pick<GroupDetail['members'][number], 'id' | 'displayName' | 'imageUrl' | 'fallbackImageUrl'>;
  suggestion: { direction: 'pay' | 'receive'; amountCents: number } | null;
  incoming: Repayment[];
  outgoing: Repayment[];
};

function todoFor(bill: Bill): BillTodo | null {
  // Keep this predicate aligned with server/src/attention.ts, including a zero
  // share being submitted, not missing. Item claims use the same share snapshot.
  const mine = bill.participants.find(participant => participant.isCurrentUser);
  if (!mine || mine.confirmedAt !== null || bill.completedAt !== null || bill.canceledAt !== null) return null;
  if (bill.mode === 'items') return mine.amountCents === null ? 'Claim your items' : 'Confirm your items';
  return mine.amountCents === null ? 'Enter your share' : 'Confirm your share';
}

// The loaded group is membership-authorized and includes the current member.
// Bills arrive newest-created first from the server; filtering and stable sorting
// preserve that order. No balances, suggestions, or pending totals are calculated.
export function groupView(data: GroupPageData) {
  const me = data.group.members.find(member => member.isCurrentUser)!;
  const members = new Map(data.group.members.map(member => [member.id, member]));
  const name = (id: string) => id === me.id ? 'You' : members.get(id)?.displayName ?? 'Member';
  const open: OpenBill[] = [];
  const history: Bill[] = [];
  for (const bill of data.bills) {
    if (bill.completedAt !== null || bill.canceledAt !== null) history.push(bill);
    else open.push({
      bill,
      todo: todoFor(bill),
      waitingFor: bill.participants
        .filter(participant => participant.confirmedAt === null && !participant.isCurrentUser)
        .map(participant => participant.displayName),
    });
  }
  open.sort((a, b) => Number(a.todo === null) - Number(b.todo === null));

  const repayments = [...data.repayments].sort((a, b) =>
    Number(a.status !== 'pending') - Number(b.status !== 'pending') ||
    b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
  const byMember = new Map<string, DashboardRow>();
  function row(id: string) {
    let entry = byMember.get(id);
    if (!entry) {
      // Suggestions and records refer to group members; retain a readable fallback
      // if a refreshed group snapshot has not arrived alongside the ledger yet.
      entry = { member: members.get(id) ?? { id, displayName: 'Member' }, suggestion: null, incoming: [], outgoing: [] };
      byMember.set(id, entry);
    }
    return entry;
  }
  for (const suggestion of data.ledger.suggestions) {
    if (suggestion.fromUserId === me.id) row(suggestion.toUserId).suggestion = { direction: 'pay', amountCents: suggestion.amountCents };
    else if (suggestion.toUserId === me.id) row(suggestion.fromUserId).suggestion = { direction: 'receive', amountCents: suggestion.amountCents };
  }
  for (const record of repayments) {
    if (record.status !== 'pending') continue;
    // Keep every actual transfer, including multiple records in either direction.
    // Their amounts must not be netted against a suggestion or one another.
    if (record.recipientId === me.id) row(record.senderId).incoming.push(record);
    else if (record.senderId === me.id) row(record.recipientId).outgoing.push(record);
  }
  const rank = (entry: DashboardRow) => entry.incoming.length ? 0 : entry.suggestion?.direction === 'pay' && !entry.outgoing.length ? 1 : 2;
  const rows = [...byMember.values()].sort((a, b) => rank(a) - rank(b));

  return {
    me, name, open, history, rows, repayments,
    netCents: data.summary.netCents,
    uncountedBills: data.ledger.incompleteBillIds.length,
    members: data.ledger.members,
    suggestions: data.ledger.suggestions,
  };
}

export type GroupView = ReturnType<typeof groupView>;

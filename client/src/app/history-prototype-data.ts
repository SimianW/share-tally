// Throwaway sample records from the user's screenshot. Never sent to a server.
import type { Bill } from '@share-tally/domain/contracts/bills';
import type { GroupPageData } from '../features/ledger/group-view';
import type { BillApi } from '../features/bills/api';

const timestamp = '2026-10-01T12:00:00Z';
const members = ['Simon', 'Yiming Zhai', 'Carl Yan'].map((displayName, index) => ({
  id: `member-${index}`, displayName, joinedAt: timestamp, isCreator: index === 0, isCurrentUser: index === 0,
}));

function bill(id: string, title: string, totalCents: number, initiator: number, participantIndexes: number[], canceled: boolean, confirmedCount: number): Bill {
  return {
    id, groupId: 'history-prototype', mode: 'manual', initiatorId: members[initiator].id,
    title, purchaseDate: '2026-10-01', notes: '', totalCents,
    submittedCents: canceled ? 0 : totalCents, differenceCents: canceled ? totalCents : 0,
    confirmedCount, adjustmentCents: canceled ? null : 0,
    completedAt: canceled ? null : timestamp, canceledAt: canceled ? timestamp : null, revision: 1,
    participants: participantIndexes.map((index, position) => ({
      userId: members[index].id, displayName: members[index].displayName, isCurrentUser: index === 0,
      amountCents: canceled ? null : Math.floor(totalCents / participantIndexes.length) + (position === 0 ? totalCents % participantIndexes.length : 0),
      confirmedAt: position < confirmedCount ? timestamp : null,
    })),
  };
}

const bills = [
  bill('cake', 'Cake test', 10000, 0, [0, 1, 2], true, 0),
  bill('rent', '房租', 4000, 1, [0, 1], false, 2),
  bill('rent-september', 'xita给我40元9月房租', 4000, 0, [0, 1], false, 2),
  bill('old-rent', '前两月房租', 8000, 2, [0, 1, 2], true, 1),
  bill('walmart', 'Walmart', 14800, 2, [0, 1, 2], false, 3),
  bill('walmart-canceled', 'Walmart', 14800, 2, [0, 1, 2], true, 0),
  bill('utilities', '水电费 9/10', 7588, 0, [0, 1, 2], false, 3),
];

export function historyPrototypeData(scenario: string): GroupPageData {
  const selected = scenario === 'only-canceled' ? bills.filter(bill => bill.canceledAt)
    : scenario === 'no-canceled' ? bills.filter(bill => !bill.canceledAt)
    : scenario === 'empty' ? []
    : scenario === 'long' ? [...bills, ...bills.filter(bill => !bill.canceledAt).map(bill => ({ ...bill, id: `${bill.id}-older`, purchaseDate: '2026-09-25' }))]
    : bills;
  const entries = selected.filter(bill => bill.completedAt).map(bill => ({
    kind: 'bill' as const, id: bill.id, title: bill.title, purchaseDate: bill.purchaseDate,
    completedAt: timestamp, initiatorId: bill.initiatorId, totalCents: bill.totalCents,
    effects: bill.participants.map(p => ({ userId: p.userId, paidCents: p.userId === bill.initiatorId ? bill.totalCents : 0,
      shareCents: p.amountCents!, adjustmentCents: 0, netCents: (p.userId === bill.initiatorId ? bill.totalCents : 0) - p.amountCents! })),
  }));
  const balances = members.map(member => ({ userId: member.id, displayName: member.displayName,
    netCents: entries.reduce((sum, entry) => sum + (entry.effects.find(effect => effect.userId === member.id)?.netCents ?? 0), 0),
  }));
  const netCents = balances[0].netCents;
  const debtors = balances.filter(member => member.netCents < 0).map(member => ({ ...member, remaining: -member.netCents }));
  const creditors = balances.filter(member => member.netCents > 0).map(member => ({ ...member, remaining: member.netCents }));
  const suggestions: GroupPageData['ledger']['suggestions'] = [];
  for (const debtor of debtors) for (const creditor of creditors) {
    const amountCents = Math.min(debtor.remaining, creditor.remaining);
    if (!amountCents) continue;
    const directLines = entries.flatMap(entry => {
      const participant = entry.effects.find(effect => effect.userId === (entry.initiatorId === creditor.userId ? debtor.userId : creditor.userId));
      const cents = entry.initiatorId === creditor.userId ? participant?.shareCents ?? 0
        : entry.initiatorId === debtor.userId ? -(participant?.shareCents ?? 0) : 0;
      return cents ? [{ entryId: entry.id, cents }] : [];
    });
    const directCents = Math.max(0, directLines.reduce((sum, line) => sum + line.cents, 0));
    suggestions.push({ fromUserId: debtor.userId, toUserId: creditor.userId, amountCents,
      explanation: { directCents, directLines, passedAlongCents: amountCents - directCents } });
    debtor.remaining -= amountCents;
    creditor.remaining -= amountCents;
  }
  return {
    bills: selected,
    group: { id: 'history-prototype', name: 'Our place', icon: { type: 'lucide', value: 'house' },
      createdBy: members[0].id, createdAt: timestamp, creatorName: 'Simon', memberCount: 3,
      isCreator: true, joinedAt: timestamp, members },
    summary: { netCents, receivableCents: Math.max(0, netCents), payableCents: Math.max(0, -netCents) },
    ledger: { members: balances, suggestions, incompleteBillIds: [], entries, directDebts: [] },
    repayments: [],
  };
}

const unavailable = async (): Promise<never> => { throw new Error('This prototype uses sample data.'); };
export const historyPrototypeApi: BillApi = {
  attention: unavailable, list: unavailable, recordRepayment: unavailable, decideRepayment: unavailable,
  detail: unavailable, create: unavailable, edit: unavailable, cancel: unavailable, submit: unavailable,
};

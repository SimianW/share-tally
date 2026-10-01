// PROTOTYPE (throwaway): a fake group whose ledger reproduces the screenshot
// figures (Carl +80.71, Yiming −89.29, you +8.58) from four completed bills, one
// open bill, and one confirmed repayment.
import type { Bill } from '../bill-api';
import type { GroupPageData } from '../group-view';

const people = {
  me: 'Simian Wang',
  carl: 'Carl Yan',
  yiming: 'Yiming Zhai',
} as const;
type Person = keyof typeof people;

function bill(id: string, title: string, purchaseDate: string, initiatorId: Person, totalCents: number,
  shares: Partial<Record<Person, number | null>>, options: { open?: boolean; mode?: Bill['mode'] } = {}): Bill {
  const participants = (Object.keys(shares) as Person[]).map(userId => ({
    userId, displayName: people[userId], isCurrentUser: userId === 'me',
    amountCents: shares[userId] ?? null,
    confirmedAt: options.open && (userId === 'yiming') ? null : `${purchaseDate}T20:00:00Z`,
  }));
  const submittedCents = participants.reduce((sum, participant) => sum + (participant.amountCents ?? 0), 0);
  return {
    mode: options.mode ?? 'manual', id, groupId: 'proto-group', initiatorId, title, purchaseDate, notes: '',
    totalCents, submittedCents, differenceCents: totalCents - submittedCents,
    confirmedCount: participants.filter(participant => participant.confirmedAt).length,
    adjustmentCents: options.open ? null : totalCents - submittedCents,
    completedAt: options.open ? null : `${purchaseDate}T21:00:00Z`, canceledAt: null, revision: 1, participants,
  };
}

const bills: Bill[] = [
  bill('b5', 'Costco — Sep 30 run', '2026-09-30', 'me', 18760, { me: 6250, carl: 6260, yiming: null }, { open: true }),
  bill('b4', 'Costco — paper towels & eggs', '2026-09-27', 'carl', 12000, { carl: 4000, yiming: 8000 }),
  bill('b3', 'T&T groceries', '2026-09-21', 'yiming', 9450, { yiming: 3150, carl: 3150, me: 3150 }, { mode: 'items' }),
  bill('b2', 'Costco gas & snacks', '2026-09-14', 'me', 15342, { me: 5100, yiming: 6000, carl: 4230 }),
  bill('b1', 'Costco — Kirkland bulk run', '2026-09-06', 'carl', 24680, { carl: 8588, yiming: 9870, me: 6222 }, { mode: 'items' }),
];

export const mockGroup: GroupPageData = {
  bills,
  repayments: [{
    id: 'r1', groupId: 'proto-group', senderId: 'yiming', recipientId: 'carl', amountCents: 8641,
    status: 'confirmed', createdAt: '2026-09-24T18:00:00Z', decidedAt: '2026-09-25T09:30:00Z',
  }],
  summary: { receivableCents: 858, payableCents: 0, netCents: 858 },
  ledger: {
    members: [
      { userId: 'carl', displayName: people.carl, netCents: 8071 },
      { userId: 'yiming', displayName: people.yiming, netCents: -8929 },
      { userId: 'me', displayName: people.me, netCents: 858 },
    ],
    suggestions: [
      { fromUserId: 'yiming', toUserId: 'carl', amountCents: 8071 },
      { fromUserId: 'yiming', toUserId: 'me', amountCents: 858 },
    ],
    incompleteBillIds: ['b5'],
  },
  group: {
    id: 'proto-group', name: 'Costco Crew', icon: { type: 'unicode', value: '🛒' },
    createdBy: 'me', createdAt: '2026-09-01T00:00:00Z', creatorName: people.me, memberCount: 3,
    isCreator: true, joinedAt: '2026-09-01T00:00:00Z',
    members: (Object.keys(people) as Person[]).map(id => ({
      id, displayName: people[id], imageUrl: null, fallbackImageUrl: null,
      joinedAt: '2026-09-01T00:00:00Z', isCreator: id === 'me', isCurrentUser: id === 'me',
    })),
  },
};

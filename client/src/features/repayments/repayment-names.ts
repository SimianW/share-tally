import type { GroupLedger } from '@share-tally/domain/contracts/ledger';
import type { GroupDetail } from '../groups/api';

// Retained repayment history may name a former member. Current membership wins
// if stale snapshots temporarily contain the same identity in both collections.
export function repaymentDisplayName(group: GroupDetail, formerMembers: GroupLedger['formerMembers'], id: string) {
  return group.members.find(member => member.id === id)?.displayName
    ?? formerMembers.find(member => member.userId === id)?.displayName ?? 'Member';
}

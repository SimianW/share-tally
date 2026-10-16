import { memberName } from "../../shared/member-name.ts";
import type { GroupLedger } from '@share-tally/domain/contracts/ledger';
import type { GroupDetail } from '../groups/api';

// Retained repayment history may name a former member, and names people in the
// history scope: the ledger's Username wins over the member list's.
export function repaymentDisplayName(group: GroupDetail, ledger: Pick<GroupLedger, 'members' | 'formerMembers'>, id: string) {
  const person = [...ledger.members, ...ledger.formerMembers].find(member => member.userId === id);
  const member = group.members.find(member => member.id === id);
  return memberName(member ? { ...member, username: person?.username ?? member.username } : person);
}

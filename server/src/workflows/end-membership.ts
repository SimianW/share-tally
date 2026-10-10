import type { MemberDepartureReason } from '@share-tally/domain/contracts/groups';
import { db } from '../db/index.js';
import type { Transaction as Tx } from '../db/types.js';
import { incompleteBillsInvolving } from '../bills/queries.js';
import { lockGroupForMember } from '../groups/group-access.js';
import {
  endMembership, GroupAccessError, lockGroupForOwner, MemberDepartureError, memberIds, requireCurrentMember, transferOwnership,
} from '../groups/groups.js';
import { readMemberBalancesInSnapshot } from '../ledger/accounting.js';
import { notifyGroupChanged, notifyMembersChanged, notifyMembershipEnded } from '../realtime/group-events.js';
import { purgeMemberReceiptDrafts } from '../receipts/drafts/deletion.js';
import { pendingRepaymentsInvolving } from '../repayments/repayments.js';
import { safeCents } from '../shared/money.js';

// Ending a membership: a member leaving, the owner leaving after choosing a
// successor, or the owner removing another member. Each runs in one transaction
// holding the group row lock, which joins, deletion and every financial write
// take first, so the eligibility read here is still true when the membership ends.
// Ownership transfer, draft cleanup and the membership change commit together.

// Only the departing member's own activity counts: their exact net balance in
// this group, incomplete bills they initiated or take part in, and pending
// repayments they sent or must decide.
async function departureReasons(tx: Tx, groupId: string, userId: string): Promise<MemberDepartureReason[]> {
  const reasons: MemberDepartureReason[] = [];
  const netCents = safeCents((await readMemberBalancesInSnapshot(tx, userId, [groupId])).get(groupId) ?? 0n);
  if (netCents !== 0) reasons.push({ code: 'nonzero_balance', netCents });
  const bills = await incompleteBillsInvolving(tx, groupId, userId);
  if (bills.length) reasons.push({ code: 'incomplete_bills', bills });
  const repayments = await pendingRepaymentsInvolving(tx, groupId, userId);
  if (repayments.length) reasons.push({ code: 'pending_repayments', repayments });
  return reasons;
}

// Advisory: the member may check their own departure, and the owner anyone's.
export async function departureEligibility(groupId: string, actorId: string, userId: string) {
  return db.transaction(async tx => {
    const group = actorId === userId
      ? await lockGroupForMember(tx, groupId, actorId)
      : await lockGroupForOwner(tx, groupId, actorId, 'Only the group owner can remove members.');
    await requireCurrentMember(tx, groupId, userId);
    const reasons = await departureReasons(tx, groupId, userId);
    if (group.ownerId === userId && (await memberIds(tx, groupId)).length === 1) reasons.push({ code: 'sole_member' });
    return { eligible: reasons.length === 0, reasons };
  });
}

async function endIfEligible(tx: Tx, groupId: string, userId: string, subject: string) {
  const reasons = await departureReasons(tx, groupId, userId);
  if (reasons.length) throw new MemberDepartureError(subject, reasons);
  await purgeMemberReceiptDrafts(tx, groupId, userId);
  await endMembership(tx, groupId, userId);
  return memberIds(tx, groupId);
}

function announce(groupId: string, name: string, departedId: string, remainingIds: string[], removed: boolean) {
  // Ending the leaver's streams first means they hear why, not a change they can no longer read.
  notifyMembershipEnded(groupId, departedId, name, removed);
  notifyGroupChanged(groupId);
  notifyMembersChanged([departedId, ...remainingIds]);
}

// The owner names a successor; ordinary members must not. The successor needs
// no acceptance and may have any balance; ownership passes only if the owner's
// own departure commits.
export async function leaveGroup(groupId: string, userId: string, successorId?: string) {
  const { name, remaining } = await db.transaction(async tx => {
    const group = await lockGroupForMember(tx, groupId, userId);
    const owner = group.ownerId === userId;
    if (!owner && successorId !== undefined)
      throw new GroupAccessError(403, 'Only the group owner can choose a new owner.');
    if (owner) {
      const members = await memberIds(tx, groupId);
      if (members.length === 1) throw new MemberDepartureError('You cannot leave this group', [{ code: 'sole_member' }]);
      if (successorId === undefined)
        throw new GroupAccessError(409, 'Choose another member to become the group owner before you leave.');
      if (successorId === userId || !members.includes(successorId))
        throw new GroupAccessError(400, 'Choose another current member of this group as the new owner.');
    }
    // An ineligible departure throws below and rolls the transfer back with it.
    if (owner) await transferOwnership(tx, groupId, successorId!);
    return { name: group.name, remaining: await endIfEligible(tx, groupId, userId, 'You cannot leave this group yet') };
  });
  announce(groupId, name, userId, remaining, false);
}

export async function removeMember(groupId: string, ownerId: string, userId: string) {
  const { name, remaining } = await db.transaction(async tx => {
    const group = await lockGroupForOwner(tx, groupId, ownerId, 'Only the group owner can remove members.');
    if (userId === ownerId)
      throw new GroupAccessError(400, 'Leave the group instead, after choosing a new owner.');
    await requireCurrentMember(tx, groupId, userId);
    return { name: group.name, remaining: await endIfEligible(tx, groupId, userId, 'This member cannot be removed yet') };
  });
  announce(groupId, name, userId, remaining, true);
}

import { useEffect, useState } from 'react';
import { errorMessage } from '../../shared/api/error-message';
import { useOperation } from '../../shared/api/use-operation';
import { money } from '../../shared/money';
import { Button } from '../../shared/ui/Button';
import Dialog from '../../shared/ui/Dialog';
import { Notification } from '../../shared/ui/Notification';
import { MemberDepartureAccessError, type GroupApi, type GroupDetail, type MemberDepartureEligibility, type MemberDepartureReason } from './api';

type Member = GroupDetail['members'][number];

function DepartureReasons({ reasons, group, member }: {
  reasons: MemberDepartureReason[]; group: GroupDetail; member: Member;
}) {
  const name = (id: string) => group.members.find(person => person.id === id)?.displayName ?? 'Member';
  return <Notification tone="warning" title={`${member.displayName} can't leave this group yet`}>
    <p>Resolve these before leaving or removal:</p>
    <ul className="group-deletion-reasons">
      {reasons.map(reason => <li key={reason.code}>
        {reason.code === 'nonzero_balance' && <>
          {member.displayName} {reason.netCents > 0 ? 'is owed' : 'owes'} {money(Math.abs(reason.netCents))} in this group. Settle and confirm repayments until this balance is exactly zero.
        </>}
        {reason.code === 'incomplete_bills' && <>
          Relevant incomplete bills:
          <ul>{reason.bills.map(bill => <li key={bill.id}>
            <strong>{bill.title}</strong> — {member.displayName} is {bill.role === 'initiator' ? 'the Initiator' : 'a participant'}.{' '}
            {bill.role === 'initiator'
              ? 'Complete or cancel this bill before leaving.'
              : 'The Initiator must complete or cancel this bill, or remove this member as a participant.'}
          </li>)}</ul>
        </>}
        {reason.code === 'pending_repayments' && <>
          Relevant pending repayments:
          <ul>{reason.repayments.map(repayment => <li key={repayment.id}>
            {name(repayment.senderId)} sent {money(repayment.amountCents)} to {name(repayment.recipientId)}.{' '}
            {name(repayment.recipientId)} must confirm or reject this pending repayment.
          </li>)}</ul>
        </>}
        {reason.code === 'sole_member' && <>You are the sole group owner and member. Use Delete group after the group is cleared instead of leaving.</>}
      </li>)}
    </ul>
  </Notification>;
}

export function MemberDepartureDialog({ group, member, api, close, onLeft, onRemoved }: {
  group: GroupDetail; member: Member; api: GroupApi; close: () => void; onLeft: () => void; onRemoved: () => void;
}) {
  const { pending, busy, error, setError, execute } = useOperation();
  const [eligibility, setEligibility] = useState<MemberDepartureEligibility | null>(null);
  const [checking, setChecking] = useState(true);
  const [checkRevision, setCheckRevision] = useState(0);
  const [successorId, setSuccessorId] = useState('');
  const self = member.isCurrentUser;
  const transfer = self && group.isOwner;
  const successors = group.members.filter(person => !person.isCurrentUser);
  const successor = successors.find(person => person.id === successorId);
  useEffect(() => {
    const controller = new AbortController();
    api.departure(group.id, member.id, controller.signal).then(result => {
      if (!controller.signal.aborted) { setEligibility(result); setError(''); }
    }).catch(error => {
      if (!controller.signal.aborted) { setEligibility(null); setError(errorMessage(error)); }
    }).finally(() => { if (!controller.signal.aborted) setChecking(false); });
    return () => controller.abort();
  }, [api, group.id, member.id, checkRevision, setError]);
  const soleOwner = transfer && successors.length === 0;
  const canDepart = eligibility?.eligible === true && eligibility.reasons.length === 0 && !soleOwner;
  function checkAgain() {
    if (checking || pending.current) return;
    setChecking(true);
    setEligibility(null);
    setError('');
    setCheckRevision(value => value + 1);
  }
  async function depart() {
    if (pending.current || !canDepart || (transfer && !successor)) return;
    await execute(async () => {
      if (self) { await api.leave(group.id, transfer ? successorId : undefined); onLeft(); }
      else { await api.removeMember(group.id, member.id); onRemoved(); }
    }, error => {
      if (error instanceof MemberDepartureAccessError)
        setEligibility({ eligible: false, reasons: error.reasons });
      else { setEligibility(null); setError(errorMessage(error)); }
    });
  }
  return <Dialog title={self ? `Leave ${group.name}?` : `Remove ${member.displayName}?`}
    kicker={self ? 'LEAVE GROUP' : 'REMOVE MEMBER'} close={() => { if (!pending.current) close(); }}>
    <p>{self
      ? 'You will lose access to this group and its bills, ledger, repayments and photos. The group stays available to its remaining members.'
      : `${member.displayName} will lose access to this group and its bills, ledger, repayments and photos. The group stays available to its remaining members.`}</p>
    <p>Initiated bills and repayment records remain in the group's history. A valid invitation link allows rejoining as an ordinary member.</p>
    <p>{self ? 'Your' : `${member.displayName}'s`} unpublished bill drafts in this group will be deleted, including their photos.</p>
    {transfer && successors.length > 0 && <div className="group-form group-succession-form">
      <label htmlFor="group-successor">New owner</label>
      <select id="group-successor" value={successor?.id ?? ''} onChange={event => setSuccessorId(event.target.value)} disabled={busy}>
        <option value="">Choose a current member</option>
        {successors.map(person => <option key={person.id} value={person.id}>{person.displayName}</option>)}
      </select>
      <p>The new owner takes over immediately when you leave; no separate acceptance is needed. Their balance does not prevent succession.</p>
      {successor && <p>Confirm transfer of group ownership to <strong>{successor.displayName}</strong> and your departure together.</p>}
    </div>}
    {soleOwner && <Notification tone="warning">You are the sole group owner and member. Use Delete group after the group is cleared instead of leaving.</Notification>}
    {checking && <p role="status">Checking whether {member.displayName} can leave…</p>}
    {!checking && eligibility && !canDepart && !soleOwner && (eligibility.reasons.length
      ? <DepartureReasons reasons={eligibility.reasons} group={group} member={member} />
      : <Notification tone="warning">This member cannot leave yet. Check again to see what needs clearing.</Notification>)}
    {error && <Notification>{error}</Notification>}
    {canDepart && <p>Eligibility is checked again when you confirm.</p>}
    <div className="dialog-actions">
      {canDepart && <Button className="group-delete-submit" onClick={() => void depart()} disabled={busy || (transfer && !successor)}>
        {busy ? 'Saving…' : !self ? 'Remove member' : transfer ? 'Transfer and leave' : 'Leave group'}
      </Button>}
      {!checking && !canDepart && <Button onClick={checkAgain} disabled={busy}>Check again</Button>}
      <Button variant="secondary" onClick={close} disabled={busy}>Cancel</Button>
    </div>
  </Dialog>;
}

import { errorMessage } from '../../shared/api/error-message';
import { useSyncSession } from '../../shared/api/SyncSession';
import { ArrowRight,RefreshCw } from 'lucide-react';
import { useEffect,useRef,useState } from 'react';
import { startGroupSync } from '../../shared/api/group-sync';
import { AccessError, denied, hideProtectedQueries, useCached } from '../../shared/api/query-cache';
import { useQueryClient } from '@tanstack/react-query';
import { useOperation } from '../../shared/api/use-operation';
import { money } from "../../shared/money";
import { Avatar } from "../../shared/ui/Avatar";
import { Button } from "../../shared/ui/Button";
import Dialog from '../../shared/ui/Dialog';
import { Notification } from '../../shared/ui/Notification';
import { GroupDeletionAccessError,type GroupApi,type GroupDeletionEligibility,type GroupDeletionReason,type GroupDetail } from "./api";
import { MemberDepartureDialog } from './MemberDepartureDialog';

export function GroupDetails({ id, api, close, onViewBills, onDeleted, onLeft }: {
  id: string; api: GroupApi; close: () => void; onViewBills?: () => void; onDeleted: () => void; onLeft: () => void;
}) {
  const session = useSyncSession();
  const cache = useQueryClient();
  const query = useCached<{ group: GroupDetail }>(`/groups/${id}`);
  const accessLost = denied(query.error);
  const group = query.data?.group;
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const live = useRef<ReturnType<typeof startGroupSync> | null>(null);
  const [confirmingDeletion, setConfirmingDeletion] = useState(false);
  const [departingId, setDepartingId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const departing = group?.members.find(member => member.id === departingId);
  const currentMember = group?.members.find(member => member.isCurrentUser);
  useEffect(() => {
    const sync = startGroupSync({ groupId: id, session,
      read: signal => api.detail(id, signal),
      accessDenied: (status, error) => hideProtectedQueries(cache, `/groups/${id}`, error ?? new AccessError(status, status === 401 ? 'Please sign in again.' : 'Group not found.')), apply: () => setLoading(false),
      status: message => { setError(message); setLoading(false); },
    });
    live.current = sync;
    return () => { sync.stop(); live.current = null; };
  }, [api, session, id, cache]);
  function refresh() { if (accessLost) return; setLoading(true); live.current?.retry(); }
  return (
    <Dialog title={group?.name ?? 'Group'} kicker="YOUR PEOPLE" close={close}>
      {loading && !group && <p role="status">Loading members…</p>}
      {error && <Notification>{error}</Notification>}
      {message && <Notification tone="success" onDismiss={() => setMessage('')}>{message}</Notification>}
      {group && onViewBills && <div className="group-bills-action">
        <Button onClick={onViewBills}>
          View bills and balance <ArrowRight size={18} aria-hidden="true" />
        </Button>
      </div>}
      <div className="group-members-toolbar">
        {group && <p className="dialog-intro">{group.memberCount} {group.memberCount === 1 ? 'member' : 'members'} · Maximum 16</p>}
        <Button variant="text" onClick={refresh} disabled={loading || accessLost}>
          <RefreshCw size={16} aria-hidden="true" /> Refresh members
        </Button>
      </div>
      {group && <>
        {group.members.map(member => <div className="member-row" key={member.id}>
          <Avatar name={member.displayName} imageUrl={member.imageUrl} fallbackImageUrl={member.fallbackImageUrl} />
          <span>{member.displayName}{member.isCurrentUser ? ' · You' : ''}</span>
          {member.isOwner && <strong>Owner</strong>}
          {group.isOwner && !member.isCurrentUser && <Button variant="text" className="member-remove bill-danger"
            onClick={() => { setMessage(''); setDepartingId(member.id); }}>Remove</Button>}
        </div>)}
        <section className="group-leave-controls">
          <h3>Leave group</h3>
          {group.isOwner && group.memberCount === 1
            ? <p>You are the sole group owner and member. Use Delete group below after the group is cleared instead of leaving.</p>
            : <>
              <p>{group.isOwner ? 'Choose another current member as the new group owner, then transfer ownership and leave together.' : 'Leave this group without deleting it for the other members.'}</p>
              <p>Your unpublished bill drafts in this group will be deleted, including their photos.</p>
              <Button variant="secondary" onClick={() => { setMessage(''); setDepartingId(currentMember?.id ?? null); }}>Leave group</Button>
            </>}
        </section>
        {group.isOwner && <>
          <InvitationControls id={id} api={api} />
          <section className="group-delete-controls">
            <h3>Delete group</h3>
            <p>Only the group owner can delete a group after all balances, bills and repayments are cleared.</p>
            <Button variant="secondary" className="bill-danger" onClick={() => setConfirmingDeletion(true)}>Delete group</Button>
          </section>
        </>}
      </>}
      {group?.isOwner && confirmingDeletion &&
        <DeleteGroupDialog group={group} api={api} close={() => setConfirmingDeletion(false)} onDeleted={onDeleted} />}
      {group && departing && (departing.isCurrentUser || group.isOwner) &&
        <MemberDepartureDialog key={departing.id} group={group} member={departing} api={api}
          close={() => setDepartingId(null)} onLeft={onLeft}
          onRemoved={() => { setDepartingId(null); setMessage(`${departing.displayName} was removed from the group.`); refresh(); }} />}
    </Dialog>
  );
}

function DeletionReasons({ reasons }: { reasons: GroupDeletionReason[] }) {
  return <Notification tone="warning" title="This group isn't ready to delete">
    <p>Clear these first:</p>
    <ul className="group-deletion-reasons">
      {reasons.map(reason => <li key={reason.code}>
        {reason.code === 'incomplete_bills' && <>{reason.count} incomplete {reason.count === 1 ? 'bill needs' : 'bills need'} to be completed or canceled.</>}
        {reason.code === 'pending_repayments' && <>{reason.count} pending {reason.count === 1 ? 'repayment needs' : 'repayments need'} a response.</>}
        {reason.code === 'nonzero_balances' && <>
          {reason.members.length === 1 ? 'One member has' : `${reason.members.length} members have`} a non-zero balance:
          <ul>{reason.members.map(member => <li key={member.userId}>
            {member.displayName} {member.netCents > 0 ? 'is owed' : 'owes'} {money(Math.abs(member.netCents))}.
          </li>)}</ul>
        </>}
      </li>)}
    </ul>
  </Notification>;
}

function DeleteGroupDialog({ group, api, close, onDeleted }: {
  group: GroupDetail; api: GroupApi; close: () => void; onDeleted: () => void;
}) {
  const [name, setName] = useState('');
  const { pending, busy, error, setError, execute } = useOperation();
  const [eligibility, setEligibility] = useState<GroupDeletionEligibility | null>(null);
  const [checking, setChecking] = useState(true);
  const [checkRevision, setCheckRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    api.deletion(group.id, controller.signal).then(result => {
      if (!controller.signal.aborted) { setEligibility(result); setError(''); }
    }).catch(error => {
      if (!controller.signal.aborted) { setEligibility(null); setError(errorMessage(error)); }
    }).finally(() => { if (!controller.signal.aborted) setChecking(false); });
    return () => controller.abort();
  }, [api, group.id, checkRevision, setError]);
  const canDelete = eligibility?.eligible === true && eligibility.reasons.length === 0;
  function checkAgain() {
    if (checking || pending.current) return;
    setChecking(true);
    setEligibility(null);
    setError('');
    setCheckRevision(value => value + 1);
  }
  async function remove() {
    if (pending.current || !canDelete || name !== group.name) return;

    await execute(async () => {
      await api.delete(group.id);
      onDeleted();
    }, (error) => {
      if (error instanceof GroupDeletionAccessError) {
        setEligibility({ eligible: false, reasons: error.reasons });
        setName('');
      } else {
        setEligibility(null);
        setError(errorMessage(error));
      }
    });
  }
  return <Dialog title={`Delete ${group.name}?`} kicker="DELETE GROUP"
    close={() => { if (!pending.current) close(); }}>
    <p>This removes the group for every member. Bills and repayment records are retained, but the group and its invitation link will no longer be accessible.</p>
    <p>Deletion is allowed only when every balance is zero, all bills are complete or canceled, and no repayment is pending.</p>
    {checking && <p role="status">Checking whether this group can be deleted…</p>}
    {!checking && eligibility && !canDelete && (eligibility.reasons.length
      ? <DeletionReasons reasons={eligibility.reasons} />
      : <Notification tone="warning">This group cannot be deleted yet. Check again to see what needs clearing.</Notification>)}
    {error && <Notification>{error}</Notification>}
    {canDelete && <form className="group-form group-delete-form" onSubmit={event => { event.preventDefault(); void remove(); }}>
      <label>Type <strong>{group.name}</strong> to confirm
        <input value={name} onChange={event => setName(event.target.value)} autoComplete="off" data-autofocus />
      </label>
      <div className="dialog-actions">
        <Button type="submit" className="group-delete-submit" disabled={busy || name !== group.name}>
          {busy ? 'Deleting…' : 'Delete group'}
        </Button>
        <Button variant="secondary" onClick={close} disabled={busy}>Cancel</Button>
      </div>
    </form>}
    {!canDelete && <div className="dialog-actions">
      {!checking && <Button onClick={checkAgain}>Check again</Button>}
      <Button variant="secondary" onClick={close}>Cancel</Button>
    </div>}
  </Dialog>;
}

function InvitationControls({ id, api }: { id: string; api: GroupApi }) {
  const [link, setLink] = useState('');
  const { pending, busy, error, setError, execute } = useOperation();
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState('');
  async function retrieve(regenerate: boolean) {
    if (pending.current) return;
     setMessage('');
    // Do not leave a possibly invalidated link available after a failed rotation response.
    if (regenerate) setLink('');
    await execute(async () => {
      const result = await api.invitation(id, regenerate);
      setLink(new URL(result.path, window.location.origin).href);
      setConfirming(false);
      setMessage(regenerate ? 'New link ready. The previous link no longer accepts joins.' : 'Link ready to share.');
    }, (error) => { setError(errorMessage(error)); });
  }
  async function copy() {
    try { await navigator.clipboard.writeText(link); setMessage('Invitation link copied.'); }
    catch { setMessage('Select the link below and copy it manually.'); }
  }
  return <section className="invitation-controls">
    <h3>Invite friends</h3>
    <p>Anyone with this link can sign in and join while the group has fewer than 16 members. Only the group owner can get or replace it here.</p>
    {error && <Notification>{error}</Notification>}
    {message && (message.startsWith("Select") ? <Notification tone="info" title="Copy the link manually">{message}</Notification> : <Notification tone="success" onDismiss={() => setMessage('')}>{message}</Notification>)}
    {link ? <>
      <label>Invitation link<input readOnly value={link} onFocus={event => event.target.select()} /></label>
      <Button onClick={copy} disabled={busy}>Copy invitation link</Button>
    </> : <Button onClick={() => void retrieve(false)} disabled={busy}>{busy ? 'Loading…' : 'Get invitation link'}</Button>}
    {confirming ? <div className="regenerate-confirmation">
      <p>Replace the invitation link? The old link will stop working. Current members will stay in the group.</p>
      <div className="dialog-actions">
        <Button onClick={() => void retrieve(true)} disabled={busy}>Replace link</Button>
        <Button variant="secondary" onClick={() => setConfirming(false)} disabled={busy}>Cancel</Button>
      </div>
    </div> : <Button variant="secondary" onClick={() => setConfirming(true)} disabled={busy}>Regenerate link</Button>}
  </section>;
}

export function JoinGroup({ token, api, joined, close }: {
  token: string; api: GroupApi; joined: (group: GroupDetail) => void; close: () => void;
}) {
  const { pending, busy, error, setError, execute } = useOperation();
  async function join() {
    if (pending.current) return;

    await execute(async () => { joined((await api.join(token)).group); }, (error) => { setError(errorMessage(error)); });
  }
  return <Dialog title="Join your friends" kicker="YOU'RE INVITED" close={() => { if (!pending.current) close(); }}>
    <p>Join this group to see its members and shared purchases.</p>
    {error && <Notification>{error}</Notification>}
    <div className="dialog-actions">
      <Button onClick={() => void join()} disabled={busy}>{busy ? 'Joining…' : 'Join group'}</Button>
      <Button variant="secondary" onClick={close} disabled={busy}>Cancel</Button>
    </div>
  </Dialog>;
}

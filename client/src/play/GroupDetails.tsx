import { Notification, SuccessNotification } from './Notification';
import { ArrowRight, RefreshCw } from 'lucide-react';
import { useCached } from './query-cache';
import { useEffect, useRef, useState } from 'react';
import Dialog from './Dialog';
import { Avatar, Button } from './ui';
import { errorMessage, type GroupApi, type GroupDetail } from './group-api';

export function GroupDetails({ id, api, close, onViewBills }: { id: string; api: GroupApi; close: () => void; onViewBills?: () => void }) {
  const query = useCached<{ group: GroupDetail }>(`/groups/${id}`);
  const group = query.data?.group;
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    api.detail(id, controller.signal).then(() => {
      if (!controller.signal.aborted) { setError(''); }
    }).catch(error => {
      if (!controller.signal.aborted) setError(errorMessage(error));
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [id, api, revision]);
  function refresh() { setLoading(true); setRevision(value => value + 1); }
  return (
    <Dialog title={group?.name ?? 'Group'} kicker="YOUR PEOPLE" close={close}>
      {loading && !group && <p role="status">Loading members…</p>}
      {error && <Notification>{error}</Notification>}
      {group && !error && onViewBills && <div className="group-bills-action">
        <Button onClick={onViewBills}>
          View bills and balance <ArrowRight size={18} aria-hidden="true" />
        </Button>
      </div>}
      <div className="group-members-toolbar">
        {group && !error && <p className="dialog-intro">{group.memberCount} {group.memberCount === 1 ? 'member' : 'members'} · Maximum 16</p>}
        <Button variant="text" onClick={refresh} disabled={loading}>
          <RefreshCw size={16} aria-hidden="true" /> Refresh members
        </Button>
      </div>
      {group && !error && <>
        {group.members.map(member => <div className="member-row" key={member.id}>
          <Avatar name={member.displayName} imageUrl={member.imageUrl} fallbackImageUrl={member.fallbackImageUrl} />
          <span>{member.displayName}{member.isCurrentUser ? ' · You' : ''}</span>
          {member.isCreator && <strong>Creator</strong>}
        </div>)}
        {group.isCreator && <InvitationControls id={id} api={api} />}
      </>}
    </Dialog>
  );
}

function InvitationControls({ id, api }: { id: string; api: GroupApi }) {
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  async function retrieve(regenerate: boolean) {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(''); setMessage('');
    // Do not leave a possibly invalidated link available after a failed rotation response.
    if (regenerate) setLink('');
    try {
      const result = await api.invitation(id, regenerate);
      setLink(new URL(result.path, window.location.origin).href);
      setConfirming(false);
      setMessage(regenerate ? 'New link ready. The previous link no longer accepts joins.' : 'Link ready to share.');
    } catch (error) { setError(errorMessage(error)); }
    finally { pending.current = false; setBusy(false); }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(link); setMessage('Invitation link copied.'); }
    catch { setMessage('Select the link below and copy it manually.'); }
  }
  return <section className="invitation-controls">
    <h3>Invite friends</h3>
    <p>Anyone with this link can sign in and join while the group has fewer than 16 members. Only you can get or replace it here.</p>
    {error && <Notification>{error}</Notification>}
    {message && (message.startsWith("Select") ? <Notification tone="info" title="Copy the link manually">{message}</Notification> : <SuccessNotification message={message} />)}
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
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState('');
  async function join() {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError('');
    try { joined((await api.join(token)).group); }
    catch (error) { setError(errorMessage(error)); }
    finally { pending.current = false; setBusy(false); }
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

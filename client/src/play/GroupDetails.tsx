import { useEffect, useRef, useState } from 'react';
import Dialog from './Dialog';
import { Avatar, Button } from './ui';
import { errorMessage, type GroupApi, type GroupDetail } from './group-api';

export function GroupDetails({ id, api, close, onViewBills }: { id: string; api: GroupApi; close: () => void; onViewBills?: () => void }) {
  const [group, setGroup] = useState<GroupDetail | null>(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    api.detail(id, controller.signal).then(({ group }) => {
      if (!controller.signal.aborted) { setGroup(group); setError(''); }
    }).catch(error => {
      if (!controller.signal.aborted) setError(errorMessage(error));
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [id, api, revision]);
  function refresh() { setLoading(true); setRevision(value => value + 1); }
  return (
    <Dialog title={group?.name ?? 'Group'} kicker="YOUR PEOPLE" close={close}>
      {loading && <p role="status">Loading members…</p>}
      {error && <p role="alert" className="form-error">{error}</p>}
      <Button variant="secondary" onClick={refresh} disabled={loading}>Refresh members</Button>
      {group && !error && <>
        <Button onClick={onViewBills ?? (() => { window.location.hash = `/group-bills/${id}`; })}>View bills and balance</Button>
        <p className="dialog-intro">{group.memberCount} {group.memberCount === 1 ? 'member' : 'members'} · Maximum 16</p>
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
    {error && <p role="alert" className="form-error">{error}</p>}
    {message && <p role="status">{message}</p>}
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
    {error && <p role="alert" className="form-error">{error}</p>}
    <div className="dialog-actions">
      <Button onClick={() => void join()} disabled={busy}>{busy ? 'Joining…' : 'Join group'}</Button>
      <Button variant="secondary" onClick={close} disabled={busy}>Cancel</Button>
    </div>
  </Dialog>;
}

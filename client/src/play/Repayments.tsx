import { requestId } from "./request-id";
import { Notification } from './Notification';
import { useRef, useState } from 'react';
import { BillApiError, money, parseMoney, type BillApi, type Repayment, type RepaymentDraft } from './bill-api';
import { errorMessage, type GroupDetail } from './group-api';
import Dialog from './Dialog';
import { Button } from './ui';

const statusLabel = { pending: 'Pending', confirmed: 'Confirmed', rejected: 'Rejected' };

export function Repayments({ group, records, api, refresh, selectedId }: {
  selectedId?: string; group: GroupDetail; records: Repayment[]; api: BillApi; refresh: () => void;
}) {
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<Repayment | null>(() => records.find(record => record.id === selectedId && record.recipientId === group.members.find(member => member.isCurrentUser)?.id) ?? null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const me = group.members.find(member => member.isCurrentUser)!;
  const name = (id: string) => group.members.find(member => member.id === id)?.displayName ?? 'Member';
  // Refreshes may reveal a decision made in another tab while this dialog is open.
  const current = selected ? records.find(record => record.id === selected.id) ?? selected : null;
  async function decide(decision: 'confirmed' | 'rejected') {
    if (!current || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      await api.decideRepayment(current.id, decision);
      setSelected(null);
      refresh();
    } catch (error) {
      setError(errorMessage(error));
      if (error instanceof BillApiError && error.status === 409) refresh();
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return <section className="repayments" aria-label="Repayment history">
    <div className="bill-heading"><h2>Repayments</h2><Button onClick={() => setCreating(true)} disabled={group.members.length < 2}>Record repayment</Button></div>
    <p>Record money you have already sent outside ShareTally. Only the recipient can confirm receipt. Pending and rejected records do not change balances.</p>
    {records.length === 0 ? <p>No repayments recorded.</p> : <ul className="repayment-list">
      {records.map(record => <li key={record.id}>
        <div><strong>{name(record.senderId)} → {name(record.recipientId)}</strong><span>{money(record.amountCents)} · {statusLabel[record.status]}</span><small>Recorded {new Date(record.createdAt).toLocaleString()}</small></div>
        {record.status === 'pending' && record.recipientId === me.id && <Button onClick={() => { setSelected(record); setError(''); }}>Review repayment</Button>}
      </li>)}
    </ul>}
    {creating && <RecordRepayment group={group} api={api} close={() => setCreating(false)} saved={() => { setCreating(false); refresh(); }} />}
    {current && <Dialog title="Review repayment" kicker={group.name} close={() => { if (!pending.current) setSelected(null); }}>
      <div className="bill-form">
        <p><strong>{name(current.senderId)}</strong> recorded sending <strong>{money(current.amountCents)}</strong> to <strong>{name(current.recipientId)}</strong>.</p>
        <p>Confirm only if you received this amount. Confirmation cannot be undone. Reject if this record is incorrect.</p>
        {error && <Notification>{error}</Notification>}
        {current.status !== 'pending' ? <Notification tone="info" title="Repayment updated">This repayment is already {current.status}.</Notification> : <div className="dialog-actions">
          <Button disabled={busy} onClick={() => void decide('confirmed')}>Confirm receipt</Button>
          <Button variant="secondary" disabled={busy} onClick={() => void decide('rejected')}>Reject record</Button>
        </div>}
      </div>
    </Dialog>}
  </section>;
}

function RecordRepayment({ group, api, close, saved }: {
  group: GroupDetail; api: BillApi; close: () => void; saved: () => void;
}) {
  const me = group.members.find(member => member.isCurrentUser)!;
  const storageKey = `repayment-creation:${me.id}:${group.id}`;
  const [request, setRequest] = useState<RepaymentDraft | null>(() => {
    try { const stored = sessionStorage.getItem(storageKey); return stored ? JSON.parse(stored) : null; }
    catch { return null; }
  });
  const [recipientId, setRecipientId] = useState(request?.recipientId ?? '');
  const [amount, setAmount] = useState(request ? (request.amountCents / 100).toFixed(2) : '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  async function submit() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      const draft = request ?? { requestId: requestId(), recipientId, amountCents: parseMoney(amount) };
      if (!draft.recipientId || draft.recipientId === me.id || draft.amountCents <= 0) throw new Error('Choose another member and enter a positive amount.');
      // Save before sending: closing or reloading after response loss preserves the request.
      sessionStorage.setItem(storageKey, JSON.stringify(draft));
      setRequest(draft);
      await api.recordRepayment(group.id, draft);
      sessionStorage.removeItem(storageKey);
      saved();
    } catch (error) {
      if (error instanceof BillApiError && [400, 403, 404].includes(error.status)) {
        sessionStorage.removeItem(storageKey);
        setRequest(null);
      }
      setError(errorMessage(error));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return <Dialog title="Record repayment" kicker={group.name} close={() => { if (!pending.current) close(); }}>
    <form className="bill-form" onSubmit={event => { event.preventDefault(); void submit(); }}>
      <p>You are recording money already sent by {me.displayName}. ShareTally moves no money. You may record a partial or excess payment, even without a matching suggestion.</p>
      <fieldset disabled={busy || request !== null}>
        <label htmlFor="repayment-recipient">Recipient</label><select id="repayment-recipient" required value={recipientId} onChange={event => setRecipientId(event.target.value)}><option value="">Choose a member</option>{group.members.filter(member => !member.isCurrentUser).map(member => <option key={member.id} value={member.id}>{member.displayName}</option>)}</select>
        <label>Amount sent · CAD<input required inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} /></label>
      </fieldset>
      {request && <p>The saved details are locked for retry. Retrying records this transfer only once, even if the previous request succeeded.</p>}
      {error && <Notification>{error}</Notification>}
      <div className="dialog-actions"><Button type="submit" disabled={busy}>{busy ? 'Saving...' : request ? 'Retry recording' : 'Record transfer'}</Button><Button variant="secondary" disabled={busy} onClick={close}>Close</Button></div>
    </form>
  </Dialog>;
}

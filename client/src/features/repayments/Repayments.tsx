import { routes } from '../../shared/browser/paths';
import { type Repayment } from "@share-tally/domain/contracts/repayments";
import { type GroupLedger } from "@share-tally/domain/contracts/ledger";
import { useState } from 'react';
import { BillApiError } from "../../shared/api/bill-error";
import { errorMessage } from "../../shared/api/error-message";
import { useOperation } from '../../shared/api/use-operation';
import { replaceRoute } from '../../shared/browser/route';
import { money } from "../../shared/money";
import { Button } from "../../shared/ui/Button";
import Dialog from '../../shared/ui/Dialog';
import { Notification } from '../../shared/ui/Notification';
import { type BillApi } from "../bills/api";
import { type GroupDetail } from "../groups/api";
import { RecordRepayment } from './RecordRepayment';
import { repaymentDisplayName } from './repayment-names';

const statusLabel = { pending: 'Pending', confirmed: 'Confirmed', rejected: 'Rejected' };

export function Repayments({ group, records, formerMembers, api, refresh, selectedId }: {
  selectedId?: string; group: GroupDetail; records: Repayment[];
  formerMembers: GroupLedger['formerMembers']; api: BillApi; refresh: () => void;
}) {
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<Repayment | null>(() => records.find(record => record.id === selectedId && record.recipientId === group.members.find(member => member.isCurrentUser)?.id) ?? null);
  const { pending, busy, error, setError, execute } = useOperation();
  const me = group.members.find(member => member.isCurrentUser)!;
  const name = (id: string) => repaymentDisplayName(group, formerMembers, id);
  // Refreshes may reveal a decision made in another tab while this dialog is open.
  const current = selected ? records.find(record => record.id === selected.id) ?? selected : null;
  const pendingRecords = records.filter(record => record.status === 'pending');
  const olderRecords = records.filter(record => record.status !== 'pending');
  function closeReview() {
    setSelected(null);
    // Remove the consumed deep link so Review can open the same record again.
    if (selectedId) replaceRoute(routes.groupBills(group.id));
  }
  function recordList(items: Repayment[]) {
    return <ul className="repayment-list">
      {items.map(record => <li key={record.id}>
        <div><strong>{name(record.senderId)} → {name(record.recipientId)}</strong><span>{money(record.amountCents)} · {statusLabel[record.status]}</span><small>Recorded {new Date(record.createdAt).toLocaleString()}</small></div>
        {record.status === 'pending' && record.recipientId === me.id && <Button className="small" onClick={() => { setSelected(record); setError(''); }}>Review repayment</Button>}
      </li>)}
    </ul>;
  }
  async function decide(decision: 'confirmed' | 'rejected') {
    if (!current || pending.current) return;

    await execute(async () => {
      await api.decideRepayment(current.id, decision);
      closeReview();
      refresh();
    }, (error) => {
      setError(errorMessage(error));
      if (error instanceof BillApiError && error.status === 409) refresh();
    });
  }
  return <section className="repayments" aria-label="Repayment history">
    <div className="repayment-heading"><h3>Repayments</h3><Button onClick={() => setCreating(true)} disabled={group.members.length < 2}>Record repayment</Button></div>
    <p>Record money you have already sent outside ShareTally. Only the recipient can confirm receipt. Pending and rejected records do not change balances.</p>
    {records.length === 0 && <p>No repayments recorded.</p>}
    {pendingRecords.length > 0 && recordList(pendingRecords)}
    {olderRecords.length > 0 && <details className="repayment-older">
      <summary>Older repayments ({olderRecords.length})</summary>
      {recordList(olderRecords)}
    </details>}
    {creating && <RecordRepayment group={group} api={api} close={() => setCreating(false)} saved={() => { setCreating(false); refresh(); }} />}
    {current && <Dialog title="Review repayment" kicker={group.name} close={() => { if (!pending.current) closeReview(); }}>
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

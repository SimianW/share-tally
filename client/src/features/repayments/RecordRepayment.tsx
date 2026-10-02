import { type RepaymentDraft, type RepaymentPrefill } from "@share-tally/domain/contracts/repayments";
import { amountText } from '../../shared/money';
import { useState } from 'react';
import { BillApiError } from "../../shared/api/bill-error";
import { errorMessage } from "../../shared/api/error-message";
import { useOperation } from '../../shared/api/use-operation';
import { requestId } from "../../shared/browser/request-id";
import { parseMoney } from "../../shared/money";
import { Button } from "../../shared/ui/Button";
import Dialog from '../../shared/ui/Dialog';
import { Notification } from '../../shared/ui/Notification';
import { type BillApi } from "../bills/api";
import { type GroupDetail } from "../groups/api";
export function RecordRepayment({ group, api, close, saved, initial }: {
  group: GroupDetail; api: BillApi; close: () => void; saved: () => void;
  initial?: RepaymentPrefill;
}) {
  const me = group.members.find(member => member.isCurrentUser)!;
  const storageKey = `repayment-creation:${me.id}:${group.id}`;
  const [request, setRequest] = useState<RepaymentDraft | null>(() => {
    try { const stored = sessionStorage.getItem(storageKey); return stored ? JSON.parse(stored) : null; }
    catch { return null; }
  });
  // A retry describes a transfer already attempted, so it must win over a new
  // suggestion. Otherwise the prefill is only an editable starting value.
  const [recipientId, setRecipientId] = useState(request?.recipientId ?? initial?.recipientId ?? '');
  const [amount, setAmount] = useState(request ? amountText(request.amountCents) : initial ? amountText(initial.amountCents) : '');
  const { pending, busy, error, setError, execute } = useOperation();
  async function submit() {
    if (pending.current) return;

    await execute(async () => {
      const draft = request ?? { requestId: requestId(), recipientId, amountCents: parseMoney(amount) };
      if (!draft.recipientId || draft.recipientId === me.id || draft.amountCents <= 0) throw new Error('Choose another member and enter a positive amount.');
      // Save before sending: closing or reloading after response loss preserves the request.
      sessionStorage.setItem(storageKey, JSON.stringify(draft));
      setRequest(draft);
      await api.recordRepayment(group.id, draft);
      sessionStorage.removeItem(storageKey);
      saved();
    }, (error) => {
      if (error instanceof BillApiError && [400, 403, 404].includes(error.status)) {
        sessionStorage.removeItem(storageKey);
        setRequest(null);
      }
      setError(errorMessage(error));
    });
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

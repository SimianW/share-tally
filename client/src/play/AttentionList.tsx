import { Notification } from './Notification';
import { useEffect, useState } from 'react';
import { money, useBillApi, type AttentionAction } from './bill-api';
import { errorMessage } from './group-api';
import { Button, Icon } from './ui';
import './attention.css';

export function AttentionList({ revision }: { revision: string }) {
  const api = useBillApi();
  const [actions, setActions] = useState<AttentionAction[] | null>(null);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let controller: AbortController;
    function load() {
      controller?.abort();
      controller = new AbortController();
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]);
      const request = controller;
      setLoading(true);
      api.attention(signal).then(result => {
        if (!request.signal.aborted) { setActions(result.actions); setError(''); }
      }).catch(error => {
        if (!request.signal.aborted) { setActions(null); setError(errorMessage(error)); }
      }).finally(() => { if (!request.signal.aborted) setLoading(false); });
    }
    const visible = () => { if (document.visibilityState === 'visible') load(); };
    load();
    window.addEventListener('focus', load);
    window.addEventListener('online', load);
    document.addEventListener('visibilitychange', visible);
    return () => {
      controller.abort();
      window.removeEventListener('focus', load);
      window.removeEventListener('online', load);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [api, revision, refresh]);

  if (!loading && !error && actions?.length === 0) return null;

  return <section className="attention-card" aria-labelledby="attention-heading" aria-busy={loading}>
    <div className="bill-heading">
      <h2 id="attention-heading">Needs your attention{actions && <small> {actions.length}</small>}</h2>
      <Button variant="text" disabled={loading} onClick={() => setRefresh(n => n + 1)}>Refresh actions</Button>
    </div>
    {loading && <p role="status">Checking your actions…</p>}
    {error && <Notification>Could not load your actions. {error} Use Refresh actions to try again.</Notification>}
    {actions && actions.length > 0 && <ul className="attention-list">
      {actions.map(action => {
        const repayment = action.kind === 'review-repayment';
        const draft = action.kind === 'review-draft';
        const label = draft ? 'Review draft' : repayment ? 'Review incoming transfer'
          : action.mode === 'items' ? action.kind === 'missing-share' ? 'Claim your items' : 'Confirm your items'
          : action.kind === 'missing-share' ? 'Enter your share' : 'Confirm your share';
        const href = draft ? `#/new-bill/${action.groupId}/${action.draftId}`
          : repayment ? `#/group-bills/${action.groupId}?repayment=${action.repaymentId}`
          : `#/bills/${action.billId}`;
        const detail = repayment ? `From ${action.senderName}` : action.title;
        const key = draft ? `draft:${action.draftId}` : repayment ? `repayment:${action.repaymentId}` : `share:${action.billId}`;
        return <li key={key}>
          <a href={href}>
            <span className="attention-type-icon"><Icon name={draft ? 'receipt' : repayment ? 'arrows' : 'basket'} /></span>
            <div className="attention-action-text"><strong>{label}</strong><span>{action.groupName} · {detail}</span></div>
            <span className="attention-action-amount">{action.amountCents !== null && `${money(action.amountCents)} CAD`} <span aria-hidden="true">→</span></span>
          </a>
        </li>;
      })}
    </ul>}
  </section>;
}

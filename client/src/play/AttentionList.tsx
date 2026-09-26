import { ChevronRight } from 'lucide-react';
import { Notification } from './Notification';
import { money } from './bill-api';
import type { Attention } from './attention';
import { Icon } from './ui';
import './attention.css';

export function AttentionList({ attention: { actions, error, loading, refresh } }: { attention: Attention }) {
  if (!loading && !error && actions?.length === 0) return null;
  // A background reload keeps the current list in place instead of flashing a loading state.
  const firstRead = loading && !actions;

  return <section className="attention-card" aria-labelledby="attention-heading" aria-busy={loading}>
    <div className="attention-header">
      <h2 id="attention-heading">Needs your attention{actions && <> <span className="count">{actions.length}</span></>}</h2>
      <button type="button" className="text-action" disabled={loading} onClick={refresh}>Refresh actions</button>
    </div>
    {firstRead && <div className="attention-skeleton" role="status" aria-label="Checking your actions">
      {[0, 1].map(row => <div key={row}><span /><span><span /><span /></span></div>)}
    </div>}
    {error && !loading && <Notification>Could not load your actions. {error} Use Refresh actions to try again.</Notification>}
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
        const type = draft ? 'draft' : repayment ? 'repayment' : 'share';
        return <li key={key}>
          <a href={href}>
            <span className={`attention-type-icon ${type}`}><Icon name={draft ? 'receipt' : repayment ? 'arrows' : 'basket'} /></span>
            <div className="attention-action-text"><strong>{label}</strong><span>{action.groupName} · {detail}</span></div>
            {action.amountCents !== null && <span className="attention-action-amount">{money(action.amountCents)} <small>CAD</small></span>}
            <ChevronRight className="attention-chevron" size={20} aria-hidden="true" />
          </a>
        </li>;
      })}
    </ul>}
  </section>;
}

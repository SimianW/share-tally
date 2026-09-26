// PROTOTYPE ONLY (#94): building blocks the five group-page layouts share.
/* eslint-disable react-refresh/only-export-components -- throwaway prototype helpers */
// Each layout arranges and styles them differently.
import { useState, type ReactNode } from 'react';
import { money } from '../bill-api';
import type { GroupDetail } from '../group-api';
import { Avatar, Button, Icon } from '../ui';
import { billMeta, todoLabel, type DashboardRow, type GroupView, type OpenBill } from './group-view';
import type { Bill } from '../bill-api';

export type LayoutProps = {
  view: GroupView;
  group: GroupDetail;
  title: ReactNode;
  drafts: ReactNode;
  records: ReactNode;
  openMembers: () => void;
  newBill: () => void;
  record: (prefill?: { recipientId: string; amountCents: number }) => void;
  review: (repaymentId: string) => void;
};

export function MemberFaces({ group, max = 5 }: { group: GroupDetail; max?: number }) {
  return <span className="gp-faces" aria-label={`${group.memberCount} group members`}>
    {group.members.slice(0, max).map(member => <Avatar key={member.id} name={member.displayName} imageUrl={member.imageUrl} fallbackImageUrl={member.fallbackImageUrl} small />)}
    {group.memberCount > max && <span className="gp-faces-more">+{group.memberCount - max}</span>}
  </span>;
}

export function HeadingActions({ openMembers, newBill }: Pick<LayoutProps, 'openMembers' | 'newBill'>) {
  return <div className="gp-actions">
    <Button variant="secondary" onClick={openMembers}><Icon name="basket" /> Members &amp; invites</Button>
    <Button onClick={newBill}><Icon name="plus" /> New bill</Button>
  </div>;
}

export function memberLine(group: GroupDetail) {
  return `${group.memberCount} ${group.memberCount === 1 ? 'member' : 'members'} · CAD`;
}

// "You're owed $X" / "You owe $X" / settled, from the server's net balance.
export function netState(view: GroupView) {
  if (view.netCents > 0) return { tone: 'owed' as const, label: "You're owed", amount: money(view.netCents) };
  if (view.netCents < 0) return { tone: 'owe' as const, label: 'You owe', amount: money(-view.netCents) };
  return { tone: 'settled' as const, label: "You're settled up", amount: null };
}

export function uncountedNote(view: GroupView) {
  if (!view.uncountedBills) return null;
  return `${view.uncountedBills} open ${view.uncountedBills === 1 ? "bill isn't" : "bills aren't"} counted yet`;
}

// One dashboard row, as words plus at most one action.
export function describeRow(row: DashboardRow, actions: Pick<LayoutProps, 'record' | 'review'>) {
  const incoming = row.pendingIncoming;
  const outgoing = row.pendingOutgoing;
  if (incoming) return {
    text: <><b>{row.otherName}</b> says they sent {money(incoming.amountCents)}</>,
    amountCents: incoming.amountCents, tone: 'pending' as const,
    action: { label: 'Review', primary: true, run: () => actions.review(incoming.id) },
    status: row.suggestedCents ? `Suggested: ${row.otherName} pays you ${money(row.suggestedCents)}` : null,
  };
  if (row.direction === 'pay') return {
    text: <>You pay <b>{row.otherName}</b></>,
    amountCents: row.suggestedCents ?? outgoing?.amountCents ?? 0, tone: 'owe' as const,
    action: outgoing ? null : { label: 'I sent this', primary: false, run: () => actions.record({ recipientId: row.otherId, amountCents: row.suggestedCents ?? 0 }) },
    status: outgoing ? `You recorded ${money(outgoing.amountCents)} · waiting for ${row.otherName} to confirm` : null,
  };
  return {
    text: <><b>{row.otherName}</b> pays you</>,
    amountCents: row.suggestedCents ?? 0, tone: 'owed' as const,
    action: null,
    status: 'Suggested transfer',
  };
}

export function TodoBadge({ entry }: { entry: OpenBill }) {
  if (entry.todo) return <span className="gp-badge gp-badge-todo">{todoLabel[entry.todo]}</span>;
  return <span className="gp-badge gp-badge-waiting">{entry.waitingFor.length ? `Waiting for ${entry.waitingFor.join(', ')}` : 'Ready to complete'}</span>;
}

export function BillLink({ bill, view, children, className = '' }: { bill: Bill; view: GroupView; children?: ReactNode; className?: string }) {
  return <a href={`#/bills/${bill.id}`} className={`gp-bill ${className}`}>
    <span className="gp-bill-icon" aria-hidden="true"><Icon name="basket" /></span>
    <span className="gp-bill-text"><strong>{bill.title}</strong><small>{billMeta(bill, view.name)}</small></span>
    {children}
  </a>;
}

export function historyStatus(bill: Bill) {
  return bill.canceledAt ? 'Canceled' : 'Complete';
}

// Latest five, then everything on request.
export function useHistory(view: GroupView, limit = 5) {
  const [all, setAll] = useState(false);
  const shown = all ? view.history : view.history.slice(0, limit);
  const more = view.history.length - shown.length;
  const toggle = more > 0
    ? <button type="button" className="gp-show-all" onClick={() => setAll(true)}>Show all {view.history.length}</button>
    : null;
  return { shown, toggle };
}

export function MemberBalances({ view }: { view: GroupView }) {
  return <ul className="gp-ledger">
    {view.members.map(member => <li key={member.userId}>
      <span>{view.name(member.userId) === 'You' ? `${member.displayName} (you)` : member.displayName}</span>
      <b className={member.netCents > 0 ? 'gp-owed' : member.netCents < 0 ? 'gp-owe' : ''}>
        {member.netCents > 0 ? '+' : member.netCents < 0 ? '−' : ''}{money(Math.abs(member.netCents))}
      </b>
    </li>)}
  </ul>;
}

export function AllSuggestions({ view }: { view: GroupView }) {
  if (!view.suggestions.length) return <p className="gp-muted">No transfers needed.</p>;
  return <ul className="gp-ledger">
    {view.suggestions.map(suggestion => <li key={`${suggestion.fromUserId}:${suggestion.toUserId}`}>
      <span>{view.name(suggestion.fromUserId)} → {view.name(suggestion.toUserId)}</span>
      <b>{money(suggestion.amountCents)}</b>
    </li>)}
  </ul>;
}

export function EmptyOpen() {
  return <p className="gp-muted gp-empty"><Icon name="check" size={16} /> No open bills. Everything here is settled into history.</p>;
}

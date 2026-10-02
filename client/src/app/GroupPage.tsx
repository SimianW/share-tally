import { routes } from '../shared/browser/paths';
import { useState, type ReactNode } from 'react';
import { AnimatedMoney } from '../shared/ui/AnimatedMoney';
import { GroupBalances } from '../features/ledger/GroupBalances';
import { money } from "../shared/money";
import { type Bill } from "@share-tally/domain/contracts/bills";
import { type BillApi } from "../features/bills/api";
import { type RepaymentPrefill } from "@share-tally/domain/contracts/repayments";
import { groupView, type DashboardRow, type GroupPageData, type GroupView, type OpenBill } from '../features/ledger/group-view';
import { RecordRepayment } from "../features/repayments/RecordRepayment";
import { Repayments } from "../features/repayments/Repayments";
import { Avatar } from "../shared/ui/Avatar";
import { Button } from "../shared/ui/Button";
import { Icon } from "../shared/ui/Icon";
import { HistoryPrototype } from './HistoryPrototype';

export function GroupPage({ data, title, drafts, api, refresh, openMembers, selectedRepaymentId }: {
  data: GroupPageData;
  title: ReactNode;
  drafts: ReactNode;
  api: BillApi;
  refresh: () => void;
  openMembers: () => void;
  selectedRepaymentId?: string;
}) {
  const view = groupView(data);
  const [showHistory, setShowHistory] = useState(false);
  const [prefill, setPrefill] = useState<RepaymentPrefill | null>(null);
  const review = (id: string) => { window.location.hash = routes.groupBills(data.group.id, encodeURIComponent(id)); };
  const tone = view.netCents > 0 ? 'owed' : view.netCents < 0 ? 'owe' : 'settled';
  return <section className="group-page">
    <header className="group-page-heading">
      <div className="group-page-title">{title}
        <p className="group-member-count">
          <span className="group-member-faces" aria-hidden="true">
            {data.group.members.slice(0, 5).map(member => <Avatar key={member.id} name={member.displayName} imageUrl={member.imageUrl} fallbackImageUrl={member.fallbackImageUrl} small />)}
            {data.group.memberCount > 5 && <span className="group-member-more">+{data.group.memberCount - 5}</span>}
          </span>
          {data.group.memberCount} {data.group.memberCount === 1 ? 'member' : 'members'} · CAD
        </p>
      </div>
      <div className="group-actions">
        <Button variant="secondary" onClick={openMembers}><Icon name="people" /> Members &amp; invites</Button>
        <Button onClick={() => { window.location.hash = routes.newBill(data.group.id); }}><Icon name="plus" /> New bill</Button>
      </div>
    </header>

    <section className="group-card group-dashboard" aria-label="Where you stand">
      <h2 className={`group-net group-tone-${tone}`}>
        <span>{view.netCents > 0 ? "You're owed" : view.netCents < 0 ? 'You owe' : "You're settled up"}{view.netCents === 0 && <span aria-hidden="true"> ✓</span>}</span>
        {view.netCents !== 0 && <> <strong><AnimatedMoney cents={view.netCents} /></strong></>}
      </h2>
      <p className="group-net-caption">From completed bills and confirmed repayments.</p>
      {view.rows.length > 0 && <ul className="group-dashboard-rows">
        {view.rows.map(row => <DashboardPerson key={row.member.id} row={row} record={setPrefill} review={review} />)}
      </ul>}
      {view.uncountedBills > 0 && <p className="group-open-note"><Icon name="clock" size={14} />{view.uncountedBills} open {view.uncountedBills === 1 ? "bill isn't" : "bills aren't"} counted yet.</p>}
    </section>

    <section aria-label="Open bills">
      <h2 className="group-section-heading">Open bills <span className="count">{view.open.length}</span></h2>
      <div className="group-card group-bill-list">
        {view.open.length ? view.open.map(entry => <GroupBill key={entry.bill.id} bill={entry.bill} view={view} entry={entry} />)
          : <p className="group-empty"><Icon name="check" size={16} />No open bills. Everything here is settled into history.</p>}
      </div>
    </section>

    <div className="group-drafts">{drafts}</div>

    {import.meta.env.DEV && new URLSearchParams(window.location.search).has('variant')
      ? <HistoryPrototype bills={view.history} renderBill={bill => <GroupBill key={bill.id} bill={bill} view={view} />} />
      : view.history.length > 0 && <section aria-label="History">
      <h2 className="group-section-heading">History <span className="count">{view.history.length}</span></h2>
      <div className="group-history-list">
        {(showHistory ? view.history : view.history.slice(0, 5)).map(bill => <GroupBill key={bill.id} bill={bill} view={view} />)}
      </div>
      {!showHistory && view.history.length > 5 && <Button className="small group-show-history" variant="secondary" onClick={() => setShowHistory(true)}>Show all {view.history.length}</Button>}
    </section>}

    <section className="group-card group-audit" aria-label="Group balances and repayments">
      <h2>Group balances &amp; repayments</h2>
      <GroupBalances data={data} view={view} />
      <Repayments key={`${data.group.id}:${selectedRepaymentId ?? ''}`} selectedId={selectedRepaymentId} group={data.group} records={view.repayments} api={api} refresh={refresh} />
    </section>
    {prefill && <RecordRepayment group={data.group} api={api} initial={prefill} close={() => setPrefill(null)} saved={() => { setPrefill(null); refresh(); }} />}
  </section>;
}

function DashboardPerson({ row, record, review }: {
  row: DashboardRow;
  record: (initial: RepaymentPrefill) => void;
  review: (id: string) => void;
}) {
  const { member, suggestion, incoming, outgoing } = row;
  return <li>
    <Avatar name={member.displayName} imageUrl={member.imageUrl} fallbackImageUrl={member.fallbackImageUrl} small />
    <div className="group-dashboard-person">
      {incoming.map(pending => <div className="group-transfer-line" key={pending.id}>
        <span><b>{member.displayName}</b> says they sent {money(pending.amountCents)}
          {incoming.length > 1 && <small>Recorded {new Date(pending.createdAt).toLocaleString()}</small>}
        </span>
        <strong className="group-tone-pending">{money(pending.amountCents)}</strong>
        <Button className="small" onClick={() => review(pending.id)}>Review</Button>
      </div>)}
      {suggestion && (incoming.length && suggestion.direction === 'receive'
        ? <p className="group-transfer-note">Suggested: {member.displayName} pays you {money(suggestion.amountCents)}</p>
        : <div className="group-transfer-line">
          <span>{suggestion.direction === 'pay' ? <>You pay <b>{member.displayName}</b></> : <><b>{member.displayName}</b> pays you</>}
            <small>Suggested transfer</small>
          </span>
          <strong className={`group-tone-${suggestion.direction === 'pay' ? 'owe' : 'owed'}`}>{money(suggestion.amountCents)}</strong>
          {suggestion.direction === 'pay' && !outgoing.length && <Button className="small" variant="secondary" onClick={() => record({ recipientId: member.id, amountCents: suggestion.amountCents })}>I sent this</Button>}
        </div>)}
      {outgoing.map(pending => <p className="group-transfer-note" key={pending.id}>
        You recorded {money(pending.amountCents)} · waiting for {member.displayName} to confirm
        {outgoing.length > 1 && <small>Recorded {new Date(pending.createdAt).toLocaleString()}</small>}
      </p>)}
    </div>
  </li>;
}

function GroupBill({ bill, view, entry }: { bill: Bill; view: GroupView; entry?: OpenBill }) {
  const initiator = view.name(bill.initiatorId);
  return <a href={routes.bill(bill.id)} className={`group-bill${entry?.todo ? ' group-bill-todo' : ''}${bill.canceledAt ? ' group-bill-canceled' : ''}`}>
    <span className="group-bill-icon" aria-hidden="true"><Icon name="basket" /></span>
    <span className="group-bill-text">
      <strong>{bill.title}</strong>
      <small>{bill.purchaseDate} · paid by {initiator === 'You' ? 'you' : initiator} · {bill.confirmedCount}/{bill.participants.length} confirmed</small>
    </span>
    <span className="group-bill-end">
      <b>{money(bill.totalCents)}</b>
      {entry ? <span className={`group-badge ${entry.todo ? 'group-badge-todo' : 'group-badge-waiting'}`}>
        {entry.todo ?? (entry.waitingFor.length ? `Waiting for ${entry.waitingFor.join(', ')}` : 'Waiting for completion')}
      </span> : <small>{bill.canceledAt ? 'Canceled' : 'Complete'}</small>}
    </span>
  </a>;
}

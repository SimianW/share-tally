// PROTOTYPE ONLY (#94) · Layout B, "Sticky sidebar": bills fill the main column;
// where you stand and the group's balances stay pinned on the right.
import { money } from '../bill-api';
import { Avatar, Icon } from '../ui';
import { AllSuggestions, BillLink, describeRow, EmptyOpen, HeadingActions, historyStatus, MemberBalances, MemberFaces, memberLine, netState, TodoBadge, uncountedNote, useHistory, type LayoutProps } from './parts';

export function SidebarLayout(props: LayoutProps) {
  const { view, group } = props;
  const net = netState(view);
  const note = uncountedNote(view);
  const history = useHistory(view);
  const face = (id: string) => group.members.find(member => member.id === id);
  return <div className="gpb">
    <header className="gp-head">
      <div className="gp-head-title">{props.title}<p><MemberFaces group={group} /> {memberLine(group)}</p></div>
      <HeadingActions {...props} />
    </header>
    <div className="gpb-grid">
      <aside className="gpb-aside">
        <section className="gpb-card gpb-dash" aria-label="Where you stand">
          <span className="eyebrow">WHERE YOU STAND</span>
          <p className={`gpb-net gp-tone-${net.tone}`}>{net.label}{net.amount ? <strong>{net.amount}</strong> : ' ✓'}</p>
          {view.rows.map(row => {
            const line = describeRow(row, props);
            const person = face(row.otherId);
            return <div className="gpb-row" key={`${row.direction}:${row.otherId}`}>
              <Avatar name={row.otherName} imageUrl={person?.imageUrl} fallbackImageUrl={person?.fallbackImageUrl} small />
              <span><span>{line.text}</span>{line.status && <small>{line.status}</small>}</span>
              <b className={`gp-tone-${line.tone}`}>{money(line.amountCents)}</b>
              {line.action && <button type="button" className={`button ${line.action.primary ? 'primary' : 'secondary'} gp-small gpb-row-action`} onClick={line.action.run}>{line.action.label}</button>}
            </div>;
          })}
          {note && <p className="gp-muted gp-note"><Icon name="clock" size={14} /> {note}.</p>}
        </section>
        <section className="gpb-card" aria-label="Group balances">
          <h3>Everyone's balance</h3>
          <MemberBalances view={view} />
          <h3>Suggested transfers</h3>
          <AllSuggestions view={view} />
        </section>
      </aside>

      <main className="gpb-main">
        <section aria-label="Open bills">
          <h2>Open bills <span className="count">{view.open.length}</span></h2>
          <div className="gpb-list">
            {view.open.length ? view.open.map(entry => <BillLink key={entry.bill.id} bill={entry.bill} view={view} className={entry.todo ? 'gp-needs-you' : ''}>
              <span className="gp-bill-end"><b>{money(entry.bill.totalCents)}</b><TodoBadge entry={entry} /></span>
            </BillLink>) : <EmptyOpen />}
          </div>
        </section>
        {props.drafts}
        {view.history.length > 0 && <section aria-label="History">
          <h2>History <span className="count">{view.history.length}</span></h2>
          <div className="gpb-list gpb-history">
            {history.shown.map(bill => <BillLink key={bill.id} bill={bill} view={view} className={bill.canceledAt ? 'gp-canceled' : ''}>
              <span className="gp-bill-end"><b>{money(bill.totalCents)}</b><small>{historyStatus(bill)}</small></span>
            </BillLink>)}
          </div>
          {history.toggle}
        </section>}
        <div className="gpb-records">{props.records}</div>
      </main>
    </div>
  </div>;
}

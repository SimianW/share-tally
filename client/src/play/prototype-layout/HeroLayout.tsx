// PROTOTYPE ONLY (#94) · Layout C, "Balance hero": a full-width band says where
// you stand, with one tile per person; the bills sit below it.
import { money } from '../bill-api';
import { Avatar, Icon } from '../ui';
import { AllSuggestions, BillLink, describeRow, EmptyOpen, HeadingActions, historyStatus, MemberBalances, MemberFaces, memberLine, netState, TodoBadge, uncountedNote, useHistory, type LayoutProps } from './parts';

export function HeroLayout(props: LayoutProps) {
  const { view, group } = props;
  const net = netState(view);
  const note = uncountedNote(view);
  const history = useHistory(view, 6);
  const face = (id: string) => group.members.find(member => member.id === id);
  return <div className="gpc">
    <header className="gp-head">
      <div className="gp-head-title">{props.title}<p><MemberFaces group={group} /> {memberLine(group)}</p></div>
      <HeadingActions {...props} />
    </header>

    <section className="gpc-hero" aria-label="Where you stand">
      <div className="gpc-net">
        <span className="eyebrow">IN THIS GROUP</span>
        <p>{net.label}{net.tone === 'settled' && ' ✓'}</p>
        {net.amount && <strong className={`gp-tone-${net.tone}`}>{net.amount}</strong>}
        {note && <small><Icon name="clock" size={13} /> {note}.</small>}
      </div>
      <div className="gpc-tiles">
        {view.rows.length ? view.rows.map(row => {
          const line = describeRow(row, props);
          const person = face(row.otherId);
          return <div className={`gpc-tile gpc-tile-${line.tone}`} key={`${row.direction}:${row.otherId}`}>
            <div className="gpc-tile-top"><Avatar name={row.otherName} imageUrl={person?.imageUrl} fallbackImageUrl={person?.fallbackImageUrl} small /><span>{line.text}</span></div>
            <b className={`gp-tone-${line.tone}`}>{money(line.amountCents)}</b>
            {line.action
              ? <button type="button" className={`button ${line.action.primary ? 'primary' : 'secondary'} gp-small`} onClick={line.action.run}>{line.action.label}</button>
              : <small>{line.status}</small>}
          </div>;
        }) : <p className="gpc-clear">No transfers involve you right now.</p>}
      </div>
    </section>

    <section className="gpc-section" aria-label="Open bills">
      <h2>Open bills <span className="count">{view.open.length}</span></h2>
      <div className="gpc-list">
        {view.open.length ? view.open.map(entry => <BillLink key={entry.bill.id} bill={entry.bill} view={view} className={entry.todo ? 'gp-needs-you' : ''}>
          <span className="gp-bill-end"><b>{money(entry.bill.totalCents)}</b><TodoBadge entry={entry} /></span>
          <Icon name="arrow" size={18} />
        </BillLink>) : <EmptyOpen />}
      </div>
    </section>

    {props.drafts}

    {view.history.length > 0 && <section className="gpc-section" aria-label="History">
      <h2>History <span className="count">{view.history.length}</span></h2>
      <div className="gpc-history">
        {history.shown.map(bill => <a key={bill.id} href={`#/bills/${bill.id}`} className={`gpc-chip ${bill.canceledAt ? 'gp-canceled' : ''}`}>
          <strong>{bill.title}</strong><span>{bill.purchaseDate} · {historyStatus(bill)}</span><b>{money(bill.totalCents)}</b>
        </a>)}
      </div>
      {history.toggle}
    </section>}

    <section className="gpc-section" aria-label="Group balances and repayments">
      <h2>Group balances &amp; repayments</h2>
      <div className="gpc-three">
        <div className="gpc-card"><h3>Everyone's balance</h3><MemberBalances view={view} /></div>
        <div className="gpc-card"><h3>Suggested transfers</h3><AllSuggestions view={view} /></div>
        <div className="gpc-card gpc-records">{props.records}</div>
      </div>
    </section>
  </div>;
}

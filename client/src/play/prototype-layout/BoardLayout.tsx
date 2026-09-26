// PROTOTYPE ONLY (#94) · Layout D, "Bill board": open bills are cards with
// progress bars, and your transfers are a strip of tickets above them.
import { money } from '../bill-api';
import { Avatar, Icon } from '../ui';
import { AllSuggestions, describeRow, EmptyOpen, HeadingActions, historyStatus, MemberBalances, MemberFaces, memberLine, netState, TodoBadge, uncountedNote, useHistory, type LayoutProps } from './parts';

export function BoardLayout(props: LayoutProps) {
  const { view, group } = props;
  const net = netState(view);
  const note = uncountedNote(view);
  const history = useHistory(view);
  const face = (id: string) => group.members.find(member => member.id === id);
  return <div className="gpd">
    <header className="gp-head">
      <div className="gp-head-title">{props.title}<p><MemberFaces group={group} /> {memberLine(group)}</p></div>
      <HeadingActions {...props} />
    </header>

    <section className="gpd-strip" aria-label="Where you stand">
      <div className={`gpd-ticket gpd-net gp-tone-${net.tone}`}>
        <span>{net.label}{net.tone === 'settled' && ' ✓'}</span>
        {net.amount && <strong>{net.amount}</strong>}
        {note && <small>{note}</small>}
      </div>
      {view.rows.map(row => {
        const line = describeRow(row, props);
        const person = face(row.otherId);
        return <div className="gpd-ticket" key={`${row.direction}:${row.otherId}`}>
          <div className="gpd-ticket-who"><Avatar name={row.otherName} imageUrl={person?.imageUrl} fallbackImageUrl={person?.fallbackImageUrl} small /><span>{line.text}</span></div>
          <b className={`gp-tone-${line.tone}`}>{money(line.amountCents)}</b>
          {line.action
            ? <button type="button" className={`button ${line.action.primary ? 'primary' : 'secondary'} gp-small`} onClick={line.action.run}>{line.action.label}</button>
            : <small>{line.status}</small>}
        </div>;
      })}
    </section>

    <section aria-label="Open bills">
      <h2>Open bills <span className="count">{view.open.length}</span></h2>
      {view.open.length ? <div className="gpd-board">
        {view.open.map(entry => {
          const confirmed = entry.bill.participants.filter(participant => participant.confirmedAt).length;
          const total = entry.bill.participants.length;
          return <a key={entry.bill.id} href={`#/bills/${entry.bill.id}`} className={`gpd-card ${entry.todo ? 'gp-needs-you' : ''}`}>
            <div className="gpd-card-top"><span className="gp-bill-icon" aria-hidden="true"><Icon name="basket" /></span><TodoBadge entry={entry} /></div>
            <strong>{entry.bill.title}</strong>
            <small>{entry.bill.purchaseDate} · paid by {view.name(entry.bill.initiatorId) === 'You' ? 'you' : view.name(entry.bill.initiatorId)}</small>
            <div className="gpd-progress" role="img" aria-label={`${confirmed} of ${total} confirmed`}><span style={{ width: `${(confirmed / total) * 100}%` }} /></div>
            <div className="gpd-card-foot"><b>{money(entry.bill.totalCents)}</b><span>{confirmed}/{total} confirmed</span></div>
          </a>;
        })}
      </div> : <EmptyOpen />}
    </section>

    {props.drafts}

    <div className="gpd-bottom">
      {view.history.length > 0 && <section aria-label="History">
        <h2>History <span className="count">{view.history.length}</span></h2>
        <ul className="gpd-history">
          {history.shown.map(bill => <li key={bill.id} className={bill.canceledAt ? 'gp-canceled' : ''}>
            <a href={`#/bills/${bill.id}`}><span>{bill.title}</span><small>{bill.purchaseDate} · {historyStatus(bill)}</small><b>{money(bill.totalCents)}</b></a>
          </li>)}
        </ul>
        {history.toggle}
      </section>}
      <section className="gpd-group" aria-label="Group balances">
        <h2>Group balances</h2>
        <div className="gpd-panel"><h3>Everyone's balance</h3><MemberBalances view={view} /><h3>Suggested transfers</h3><AllSuggestions view={view} /></div>
      </section>
    </div>
    <div className="gpd-records">{props.records}</div>
  </div>;
}

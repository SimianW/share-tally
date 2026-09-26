// PROTOTYPE ONLY (#94) · Layout A, "Calm column": one centered column in the
// agreed order, each section a quiet card.
import { money } from '../bill-api';
import { Avatar, Icon } from '../ui';
import { AllSuggestions, BillLink, describeRow, EmptyOpen, HeadingActions, historyStatus, MemberBalances, MemberFaces, memberLine, netState, TodoBadge, uncountedNote, useHistory, type LayoutProps } from './parts';

export function ColumnLayout(props: LayoutProps) {
  const { view, group } = props;
  const net = netState(view);
  const note = uncountedNote(view);
  const history = useHistory(view);
  const face = (id: string) => group.members.find(member => member.id === id);
  return <div className="gpa">
    <header className="gp-head">
      <div className="gp-head-title">{props.title}<p><MemberFaces group={group} /> {memberLine(group)}</p></div>
      <HeadingActions {...props} />
    </header>

    <section className="gpa-card gpa-dash" aria-label="Where you stand">
      <div className={`gpa-net gp-tone-${net.tone}`}>
        <span>{net.label}{net.tone === 'settled' && ' ✓'}</span>
        {net.amount && <strong>{net.amount}</strong>}
        <small>From completed bills and confirmed repayments.</small>
      </div>
      {view.rows.length > 0 && <ul className="gpa-rows">
        {view.rows.map(row => {
          const line = describeRow(row, props);
          const person = face(row.otherId);
          return <li key={`${row.direction}:${row.otherId}`}>
            <Avatar name={row.otherName} imageUrl={person?.imageUrl} fallbackImageUrl={person?.fallbackImageUrl} small />
            <span className="gpa-row-text">{line.text}{line.status && <small>{line.status}</small>}</span>
            <b className={`gp-tone-${line.tone}`}>{money(line.amountCents)}</b>
            {line.action && <button type="button" className={`button ${line.action.primary ? 'primary' : 'secondary'} gp-small`} onClick={line.action.run}>{line.action.label}</button>}
          </li>;
        })}
      </ul>}
      {note && <p className="gp-muted gp-note"><Icon name="clock" size={14} /> {note}.</p>}
    </section>

    <section className="gpa-section" aria-label="Open bills">
      <h2>Open bills <span className="count">{view.open.length}</span></h2>
      <div className="gpa-card gpa-list">
        {view.open.length ? view.open.map(entry => <BillLink key={entry.bill.id} bill={entry.bill} view={view} className={entry.todo ? 'gp-needs-you' : ''}>
          <span className="gp-bill-end"><b>{money(entry.bill.totalCents)}</b><TodoBadge entry={entry} /></span>
        </BillLink>) : <EmptyOpen />}
      </div>
    </section>

    <div className="gpa-drafts">{props.drafts}</div>

    {view.history.length > 0 && <section className="gpa-section" aria-label="History">
      <h2>History <span className="count">{view.history.length}</span></h2>
      <div className="gpa-list gpa-history">
        {history.shown.map(bill => <BillLink key={bill.id} bill={bill} view={view} className={bill.canceledAt ? 'gp-canceled' : ''}>
          <span className="gp-bill-end"><b>{money(bill.totalCents)}</b><small>{historyStatus(bill)}</small></span>
        </BillLink>)}
      </div>
      {history.toggle}
    </section>}

    <section className="gpa-card gpa-group" aria-label="Group balances and repayments">
      <h2>Group balances &amp; repayments</h2>
      <div className="gpa-two">
        <div><h3>Everyone's balance</h3><MemberBalances view={view} /></div>
        <div><h3>Suggested transfers</h3><AllSuggestions view={view} /></div>
      </div>
      {props.records}
    </section>
  </div>;
}

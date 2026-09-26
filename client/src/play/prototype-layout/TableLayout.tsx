// PROTOTYPE ONLY (#94) · Layout E, "Compact ledger": a one-line summary bar and
// a dense bill table with Open / History segments. Most information per screen.
import { useState } from 'react';
import { money } from '../bill-api';
import { Icon } from '../ui';
import { AllSuggestions, describeRow, HeadingActions, historyStatus, MemberBalances, MemberFaces, memberLine, netState, TodoBadge, uncountedNote, useHistory, type LayoutProps } from './parts';

export function TableLayout(props: LayoutProps) {
  const { view, group } = props;
  const net = netState(view);
  const note = uncountedNote(view);
  const history = useHistory(view, 8);
  const [segment, setSegment] = useState<'open' | 'history'>('open');
  const payer = (id: string) => view.name(id) === 'You' ? 'You' : view.name(id);
  return <div className="gpe">
    <header className="gp-head gpe-head">
      <div className="gp-head-title">{props.title}<p><MemberFaces group={group} /> {memberLine(group)}</p></div>
      <HeadingActions {...props} />
    </header>

    <section className="gpe-summary" aria-label="Where you stand">
      <div className={`gpe-net gp-tone-${net.tone}`}><span>{net.label}{net.tone === 'settled' && ' ✓'}</span>{net.amount && <strong>{net.amount}</strong>}</div>
      <ul className="gpe-chips">
        {view.rows.map(row => {
          const line = describeRow(row, props);
          return <li key={`${row.direction}:${row.otherId}`} className={`gpe-chip gpe-chip-${line.tone}`}>
            <span>{line.text}</span>{line.tone !== 'pending' && <b>{money(line.amountCents)}</b>}
            {line.action
              ? <button type="button" className={`button ${line.action.primary ? 'primary' : 'secondary'} gp-small`} onClick={line.action.run}>{line.action.label}</button>
              : line.status && line.tone !== 'owed' && <small>{line.status}</small>}
          </li>;
        })}
      </ul>
      {note && <p className="gp-muted gpe-note"><Icon name="clock" size={13} /> {note}</p>}
    </section>

    <section className="gpe-bills" aria-label="Bills">
      <div className="gpe-segments" role="tablist" aria-label="Bills">
        <button type="button" role="tab" aria-selected={segment === 'open'} onClick={() => setSegment('open')}>Open <span className="count">{view.open.length}</span></button>
        <button type="button" role="tab" aria-selected={segment === 'history'} onClick={() => setSegment('history')}>History <span className="count">{view.history.length}</span></button>
      </div>
      <table className="gpe-table">
        <thead><tr><th>Bill</th><th>Date</th><th>Paid by</th><th>Confirmed</th><th className="gpe-num">Amount</th><th>{segment === 'open' ? 'Status' : 'Result'}</th></tr></thead>
        <tbody>
          {segment === 'open'
            ? view.open.map(entry => <tr key={entry.bill.id} className={entry.todo ? 'gp-needs-you' : ''}>
              <td><a href={`#/bills/${entry.bill.id}`}>{entry.bill.title}</a></td>
              <td>{entry.bill.purchaseDate}</td>
              <td>{payer(entry.bill.initiatorId)}</td>
              <td>{entry.bill.participants.filter(participant => participant.confirmedAt).length}/{entry.bill.participants.length}</td>
              <td className="gpe-num">{money(entry.bill.totalCents)}</td>
              <td><TodoBadge entry={entry} /></td>
            </tr>)
            : history.shown.map(bill => <tr key={bill.id} className={bill.canceledAt ? 'gp-canceled' : ''}>
              <td><a href={`#/bills/${bill.id}`}>{bill.title}</a></td>
              <td>{bill.purchaseDate}</td>
              <td>{payer(bill.initiatorId)}</td>
              <td>{bill.participants.filter(participant => participant.confirmedAt).length}/{bill.participants.length}</td>
              <td className="gpe-num">{money(bill.totalCents)}</td>
              <td>{historyStatus(bill)}</td>
            </tr>)}
        </tbody>
      </table>
      {segment === 'open' && !view.open.length && <p className="gp-muted gp-empty">No open bills.</p>}
      {segment === 'history' && history.toggle}
    </section>

    {props.drafts}

    <section className="gpe-group" aria-label="Group balances and repayments">
      <div><h3>Everyone's balance</h3><MemberBalances view={view} /></div>
      <div><h3>Suggested transfers</h3><AllSuggestions view={view} /></div>
      <div className="gpe-records">{props.records}</div>
    </section>
  </div>;
}

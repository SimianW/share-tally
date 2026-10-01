import { useId, useState, useSyncExternalStore } from 'react';
import { AnimatedMoney } from './AnimatedMoney';
import { money, type LedgerEntry } from './bill-api';
import type { GroupPageData, GroupView } from './group-view';
import { Icon } from './ui';

// A figure in the lists that the ledger table can trace.
type Subject = { kind: 'member'; userId: string };

// The group page's mobile breakpoint; tracing figures is a desktop feature.
const narrowQuery = '(max-width: 640px)';
function useNarrow() {
  return useSyncExternalStore(changed => {
    const media = window.matchMedia(narrowQuery);
    media.addEventListener('change', changed);
    return () => media.removeEventListener('change', changed);
  }, () => window.matchMedia(narrowQuery).matches);
}

const signed = (cents: number) => `${cents > 0 ? '+' : cents < 0 ? '−' : ''}${money(Math.abs(cents))}`;
const tone = (cents: number) => cents > 0 ? 'group-tone-owed' : cents < 0 ? 'group-tone-owe' : '';
const shortDate = (date: Date) => date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const localDay = (date: Date) => [date.getFullYear(), date.getMonth() + 1, date.getDate()].map(n => String(n).padStart(2, '0')).join('-');
// Rows show when an entry took effect; a bill also notes a different purchase date.
function entryDate(entry: LedgerEntry) {
  const effective = new Date(entry.kind === 'bill' ? entry.completedAt : entry.decidedAt);
  if (entry.kind === 'repayment' || localDay(effective) === entry.purchaseDate) return shortDate(effective);
  return `${shortDate(effective)} · bought ${shortDate(new Date(`${entry.purchaseDate}T12:00:00`))}`;
}

// "Everyone's balance" and "Suggested transfers", plus on desktop a collapsible
// table of the server's ledger entries that shows how each balance adds up.
// Every figure comes from the server; this only arranges and highlights them.
export function GroupBalances({ data, view }: { data: GroupPageData; view: GroupView }) {
  const traceable = !useNarrow();
  const [expanded, setExpanded] = useState(false);
  const [pinned, setPinned] = useState<Subject | null>(null);
  const [hover, setHover] = useState<Subject | null>(null);
  // Hover traces only while expanded, so the section never jumps open under the pointer.
  const active = traceable && expanded ? pinned ?? hover : null;
  const sectionId = useId();
  const headingId = useId();
  const pin = (subject: Subject) => {
    if (!expanded) { setExpanded(true); setPinned(subject); return; }
    setPinned(current => current?.userId === subject.userId ? null : subject);
  };
  const toggle = () => { setExpanded(value => !value); setPinned(null); };

  return <>
    <div className="group-audit-columns">
      <section aria-label="Everyone's balance">
        <h3>Everyone's balance</h3>
        <ul className="group-ledger-rows">
          {view.members.map(member => {
            const subject: Subject = { kind: 'member', userId: member.userId };
            const figure = <strong className={tone(member.netCents)}>
              {member.netCents > 0 ? '+' : member.netCents < 0 ? '−' : ''}<AnimatedMoney cents={member.netCents} />
            </strong>;
            return <li key={member.userId} className={active?.userId === member.userId ? 'group-ledger-traced' : undefined}>
              <span>{member.displayName}{member.userId === view.me.id && ' (you)'}</span>
              {traceable ? <button type="button" className="group-ledger-figure"
                aria-label={`${member.displayName}'s balance, ${signed(member.netCents)}`}
                aria-pressed={pinned?.userId === member.userId} aria-controls={sectionId}
                title={expanded ? undefined : 'Show how this adds up'}
                onMouseEnter={() => setHover(subject)} onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(subject)} onBlur={() => setHover(null)}
                onClick={() => pin(subject)}>{figure}</button> : figure}
            </li>;
          })}
        </ul>
      </section>
      <section aria-label="Suggested transfers">
        <h3>Suggested transfers</h3>
        {view.suggestions.length ? <ul className="group-ledger-rows">
          {view.suggestions.map(suggestion => <li key={`${suggestion.fromUserId}:${suggestion.toUserId}`}>
            <span>{view.name(suggestion.fromUserId)} → {view.name(suggestion.toUserId)}</span>
            <strong>{money(suggestion.amountCents)}</strong>
          </li>)}
        </ul> : <p className="group-empty">No transfers needed.</p>}
      </section>
    </div>
    {traceable && <section id={sectionId} aria-labelledby={headingId}
      className={`ledger-trace${expanded ? ' ledger-trace-open' : ''}${active ? ' ledger-trace-active' : ''}`}>
      <h3 id={headingId}>
        <button type="button" aria-expanded={expanded} onClick={toggle}>
          How the numbers add up<Icon name="down" size={16} className="ledger-trace-chevron" />
        </button>
      </h3>
      {expanded && <>
        <p className="ledger-trace-hint">
          {active ? <>Reading down <b>{active.userId === view.me.id ? 'your' : `${view.name(active.userId)}'s`}</b> column:
            each bill adds what they paid and subtracts their share and any initiator adjustment; each confirmed repayment
            adds what they sent and subtracts what they received.</>
            : 'Hover over a balance above to trace it, or click it to keep it highlighted.'}
          {pinned && <button type="button" className="ledger-trace-unpin" onClick={() => setPinned(null)}>Unpin</button>}
        </p>
        <LedgerTable data={data} view={view} active={active} />
      </>}
    </section>}
  </>;
}

function LedgerTable({ data, view, active }: { data: GroupPageData; view: GroupView; active: Subject | null }) {
  const traced = (userId: string) => active?.userId === userId;
  const column = (userId: string, className = '') => `${className}${traced(userId) ? ' ledger-traced' : ''}`.trim() || undefined;
  const open = data.bills.filter(bill => data.ledger.incompleteBillIds.includes(bill.id));
  return <>
    <div className="ledger-table-scroll">
      <table className={`ledger-table${active ? ' ledger-table-active' : ''}`} aria-label="Bills and repayments by member">
        <thead>
          <tr>
            <th scope="col"><span>Bill or repayment</span></th>
            {view.members.map(member => <th scope="col" key={member.userId} className={column(member.userId)}>
              <span className="ledger-column-head">{view.name(member.userId)}
                {traced(member.userId) && <small>Balance</small>}</span>
            </th>)}
          </tr>
        </thead>
        <tbody>
          {data.ledger.entries.map(entry => {
            const effects = new Map(entry.effects.map(effect => [effect.userId, effect.netCents]));
            const involved = !active || effects.has(active.userId);
            const initiator = entry.kind === 'bill' ? view.name(entry.initiatorId) : '';
            return <tr key={entry.id} className={involved ? undefined : 'ledger-row-faded'}>
              <th scope="row">
                <span className="ledger-row-label">
                  {entry.kind === 'bill' ? <a href={`#/bills/${entry.id}`}>{entry.title}</a>
                    : <span>Repayment · {view.name(entry.senderId)} → {view.name(entry.recipientId)}</span>}
                  <small>{entryDate(entry)}{entry.kind === 'bill'
                    && ` · paid by ${initiator === 'You' ? 'you' : initiator} · ${money(entry.totalCents)}`}</small>
                </span>
              </th>
              {view.members.map(member => {
                const cents = effects.get(member.userId);
                return <td key={member.userId} className={column(member.userId, cents === undefined ? '' : tone(cents))}>
                  {cents === undefined ? <span><span aria-hidden="true">—</span><span className="sr-only">Not involved</span></span>
                    : <span>{signed(cents)}</span>}
                </td>;
              })}
            </tr>;
          })}
          {!data.ledger.entries.length && <tr>
            <td colSpan={view.members.length + 1} className="ledger-table-empty"><span>No complete bills or confirmed repayments yet.</span></td>
          </tr>}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row"><span>Balance</span></th>
            {view.members.map(member => <td key={member.userId} className={column(member.userId, tone(member.netCents))}>
              <span>{signed(member.netCents)}</span>
            </td>)}
          </tr>
        </tfoot>
      </table>
    </div>
    {open.length > 0 && <p className="ledger-trace-note">
      <Icon name="clock" size={13} />Not counted yet: {open.map(bill => bill.title).join(', ')} (still open)
    </p>}
  </>;
}

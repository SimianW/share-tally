import { useId, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { AnimatedMoney } from './AnimatedMoney';
import { BalanceSheet, OpenBillsNote } from './BalanceSheet';
import { money, type GroupLedger } from './bill-api';
import type { GroupPageData, GroupView } from './group-view';
import { entryCount, entryDate, minus, recentLines, signed, tone, type Suggestion, type Trace } from './ledger-trace';
import { transferReason, wording } from './transfer-reason';
import { Icon } from './ui';

// A figure in the lists that can be traced. A transfer is the pair it is
// between; its amount is only what the figure showed when it was chosen.
type Subject = { kind: 'member'; userId: string } | { kind: 'transfer'; fromId: string; toId: string; amountCents: number };
const same = (a: Subject | null, b: Subject) => a?.kind === b.kind
  && (a.kind === 'member' ? b.kind === 'member' && a.userId === b.userId
    : b.kind === 'transfer' && a.fromId === b.fromId && a.toId === b.toId);

// The group page's mobile breakpoint: wider pages trace figures in the ledger
// table, narrower ones explain a tapped row in a bottom sheet.
const narrowQuery = '(max-width: 640px)';
function useNarrow() {
  return useSyncExternalStore(changed => {
    const media = window.matchMedia(narrowQuery);
    media.addEventListener('change', changed);
    return () => media.removeEventListener('change', changed);
  }, () => window.matchMedia(narrowQuery).matches);
}

// "Everyone's balance" and "Suggested transfers", plus how each balance and
// transfer adds up from the server's ledger entries: on desktop a collapsible
// table, on mobile a bottom sheet for a tapped row.
// Every figure comes from the server; this only arranges and highlights them.
export function GroupBalances({ data, view }: { data: GroupPageData; view: GroupView }) {
  const narrow = useNarrow();
  const traceable = !narrow;
  const [expanded, setExpanded] = useState(false);
  const [pinned, setPinned] = useState<Subject | null>(null);
  const [hover, setHover] = useState<Subject | null>(null);
  const [sheet, setSheet] = useState<Subject | null>(null);
  // A live update can remove a suggested transfer; a pin or hover on it is cleared.
  const suggestionFor = (subject: Subject | null) => subject?.kind === 'transfer'
    ? view.suggestions.find(s => s.fromUserId === subject.fromId && s.toUserId === subject.toId) : undefined;
  if (pinned?.kind === 'transfer' && !suggestionFor(pinned)) setPinned(null);
  if (hover?.kind === 'transfer' && !suggestionFor(hover)) setHover(null);
  // The sheet closes likewise when what it explains is removed, and when the
  // page widens to the desktop table.
  const sheetSuggestion = suggestionFor(sheet);
  const sheetTrace: Trace | null = !narrow ? null : sheet?.kind === 'member'
    ? view.members.some(member => member.userId === sheet.userId) ? sheet : null
    : sheetSuggestion ? { kind: 'transfer', suggestion: sheetSuggestion } : null;
  if (sheet && !sheetTrace) setSheet(null);
  // Hover traces only while expanded, so the section never jumps open under the pointer.
  const active = traceable && expanded ? pinned ?? hover : null;
  const transfer = suggestionFor(active);
  const trace: Trace | null = active?.kind === 'member' ? active : transfer ? { kind: 'transfer', suggestion: transfer } : null;
  const sectionId = useId();
  const headingId = useId();
  const pin = (subject: Subject) => {
    if (!expanded) { setExpanded(true); setPinned(subject); return; }
    setPinned(current => same(current, subject) ? null : subject);
  };
  const toggle = () => { setExpanded(value => !value); setPinned(null); };
  const { subject: who, object: whom, verb } = wording(view);
  // Accessible names use display names, as balance figures do: "Bob pays Carol, $12.00".
  const displayName = (id: string) => view.members.find(member => member.userId === id)?.displayName ?? view.name(id);
  // Figures stay as they are; on desktop they become buttons that trace them.
  const traceButton = (subject: Subject, label: string, figure: ReactNode) => <button type="button"
    className="group-ledger-figure" aria-label={label}
    aria-pressed={same(pinned, subject)} aria-controls={sectionId}
    title={expanded ? undefined : 'Show how this adds up'}
    onMouseEnter={() => setHover(subject)} onMouseLeave={() => setHover(null)}
    onFocus={() => setHover(subject)} onBlur={() => setHover(null)}
    onClick={() => pin(subject)}>{figure}</button>;
  // On mobile the whole row opens its explanation. A tap does not focus a button
  // in iOS Safari, so focus it first: the sheet returns focus to it on close.
  const sheetButton = (subject: Subject, label: string, content: ReactNode) => <button type="button"
    className="group-ledger-open" aria-label={label} aria-haspopup="dialog"
    onClick={event => { event.currentTarget.focus(); setSheet(subject); }}>
    {content}<Icon name="right" size={16} />
  </button>;

  return <>
    <div className="group-audit-columns">
      <section aria-label="Everyone's balance">
        <h3>Everyone's balance</h3>
        <ul className={`group-ledger-rows${narrow ? ' group-ledger-rows-open' : ''}`}>
          {view.members.map(member => {
            const subject: Subject = { kind: 'member', userId: member.userId };
            const figure = <strong className={tone(member.netCents)}>
              {member.netCents > 0 ? '+' : member.netCents < 0 ? '−' : ''}<AnimatedMoney cents={member.netCents} />
            </strong>;
            const label = `${member.displayName}'s balance, ${signed(member.netCents)}`;
            const name = <span>{member.displayName}{member.userId === view.me.id && ' (you)'}</span>;
            return <li key={member.userId} className={same(active, subject) ? 'group-ledger-traced' : undefined}>
              {narrow ? sheetButton(subject, label, <>{name}{figure}</>) : <>{name}{traceButton(subject, label, figure)}</>}
            </li>;
          })}
        </ul>
      </section>
      <section aria-label="Suggested transfers">
        <h3>Suggested transfers</h3>
        {view.suggestions.length ? <ul className={`group-ledger-rows${narrow ? ' group-ledger-rows-open' : ''}`}>
          {view.suggestions.map(suggestion => {
            const { fromUserId: fromId, toUserId: toId, amountCents } = suggestion;
            const subject: Subject = { kind: 'transfer', fromId, toId, amountCents };
            const figure = <strong>{money(amountCents)}</strong>;
            const label = `${displayName(fromId)} pays ${displayName(toId)}, ${money(amountCents)}`;
            const name = <span>{view.name(fromId)} → {view.name(toId)}</span>;
            return <li key={`${fromId}:${toId}`} className={same(active, subject) ? 'group-ledger-traced' : undefined}>
              {narrow ? sheetButton(subject, label, <>{name}{figure}</>) : <>{name}{traceButton(subject, label, figure)}</>}
            </li>;
          })}
        </ul> : <p className="group-empty">No transfers needed.</p>}
      </section>
    </div>
    {traceable && <section id={sectionId} aria-labelledby={headingId}
      className={`ledger-trace${expanded ? ' ledger-trace-open' : ''}${trace ? ' ledger-trace-active' : ''}`}>
      <h3 id={headingId}>
        <button type="button" aria-expanded={expanded} onClick={toggle}>
          How the numbers add up<Icon name="down" size={16} className="ledger-trace-chevron" />
        </button>
      </h3>
      {expanded && <>
        <p className="ledger-trace-hint">
          {trace?.kind === 'member' ? <>Reading down <b>{trace.userId === view.me.id ? 'your' : `${view.name(trace.userId)}'s`}</b> column:
            each bill adds what they paid and subtracts their share and any initiator adjustment; each confirmed repayment
            adds what they sent and subtracts what they received.</>
            : trace ? <><b>{who(trace.suggestion.fromUserId)}</b> {verb(trace.suggestion.fromUserId, 'pay')} <b>{whom(trace.suggestion.toUserId)}</b>
              {' '}{money(trace.suggestion.amountCents)}. {trace.suggestion.explanation.directLines.length
                ? 'Highlighted rows are the bills and repayments directly between them.'
                : 'No bill or repayment is directly between them.'}</>
            : 'Hover over a balance or transfer above to trace it, or click it to keep it highlighted.'}
          {pinned && <button type="button" className="ledger-trace-unpin" onClick={() => setPinned(null)}>Unpin</button>}
        </p>
        <LedgerTable data={data} view={view} trace={trace} />
      </>}
    </section>}
    {sheetTrace && <BalanceSheet data={data} view={view} trace={sheetTrace} close={() => setSheet(null)} />}
  </>;
}

function LedgerTable({ data, view, trace }: { data: GroupPageData; view: GroupView; trace: Trace | null }) {
  const [showAll, setShowAll] = useState(false);
  const scroll = useRef<HTMLDivElement>(null);
  const transfer = trace?.kind === 'transfer' ? trace.suggestion : null;
  // A traced column's role, shown as text in its header.
  const role = (userId: string) => trace?.kind === 'member' ? trace.userId === userId && 'Balance'
    : transfer?.fromUserId === userId ? 'Pays' : transfer?.toUserId === userId && 'Receives';
  const traced = (userId: string) => !!role(userId);
  const column = (userId: string, className = '') => `${className}${traced(userId) ? ' ledger-traced' : ''}`.trim() || undefined;
  const direct = new Set(transfer?.explanation.directLines.map(line => line.entryId));
  const { entries } = data.ledger;
  const { hidden, shown } = recentLines(entries, showAll);
  // Each member's subtotal of the hidden entries; absent when none of them involve the member.
  const earlier = new Map<string, number>();
  for (const { effects } of hidden) for (const { userId, netCents } of effects) earlier.set(userId, (earlier.get(userId) ?? 0) + netCents);
  const hiddenIds = new Set(hidden.map(entry => entry.id));
  const hiddenDirect = transfer?.explanation.directLines.filter(line => hiddenIds.has(line.entryId)) ?? [];
  const earlierInvolved = !trace || (trace.kind === 'member' ? earlier.has(trace.userId) : hiddenDirect.length > 0);
  const { object: whom } = wording(view);
  const cell = (userId: string, cents: number | undefined) => <td key={userId} className={column(userId, cents === undefined ? '' : tone(cents))}>
    {cents === undefined ? <span><span aria-hidden="true">—</span><span className="sr-only">Not involved</span></span>
      : <span>{signed(cents)}</span>}
  </td>;
  const reveal = () => { setShowAll(true); scroll.current?.focus({ preventScroll: true }); };
  return <>
    <div ref={scroll} className="ledger-table-scroll" role="region" aria-label="Ledger table" tabIndex={0}>
      <table className={`ledger-table${trace ? ' ledger-table-active' : ''}`} aria-label="Bills and repayments by member">
        <thead>
          <tr>
            <th scope="col"><span>Bill or repayment</span></th>
            {view.members.map(member => <th scope="col" key={member.userId} className={column(member.userId)}>
              <span className="ledger-column-head">{view.name(member.userId)}
                {traced(member.userId) && <small>{role(member.userId)}</small>}</span>
            </th>)}
          </tr>
        </thead>
        <tbody>
          {hidden.length > 0 && <tr className={`ledger-earlier${earlierInvolved ? '' : ' ledger-row-faded'}`}>
            <th scope="row">
              <span className="ledger-row-label">
                <span>Earlier bills and repayments</span>
                <small>{entryCount(hidden.length)} · <button type="button" className="ledger-show-all" onClick={reveal}>Show all</button>
                  {transfer && hiddenDirect.length > 0 && <> · includes <b>{minus(hiddenDirect.reduce((sum, line) => sum + line.cents, 0))}</b>
                    {' '}direct between {whom(transfer.fromUserId)} and {whom(transfer.toUserId)}</>}</small>
              </span>
            </th>
            {view.members.map(member => cell(member.userId, earlier.get(member.userId)))}
          </tr>}
          {shown.map(entry => {
            const effects = new Map(entry.effects.map(effect => [effect.userId, effect.netCents]));
            const involved = !trace || (trace.kind === 'member' ? effects.has(trace.userId) : direct.has(entry.id));
            const initiator = entry.kind === 'bill' ? view.name(entry.initiatorId) : '';
            return <tr key={entry.id} className={involved ? undefined : 'ledger-row-faded'}>
              <th scope="row">
                <span className="ledger-row-label">
                  {entry.kind === 'bill' ? <a href={`#/bills/${entry.id}`}>{entry.title}</a>
                    : <span>Repayment · {view.name(entry.senderId)} → {view.name(entry.recipientId)}</span>}
                  <small>{entryDate(entry)}{entry.kind === 'bill'
                    && ` · paid by ${initiator === 'You' ? 'you' : initiator} · ${money(entry.totalCents)}`}</small>
                  {transfer && direct.has(entry.id) && <span className="sr-only">, directly between them</span>}
                </span>
              </th>
              {view.members.map(member => cell(member.userId, effects.get(member.userId)))}
            </tr>;
          })}
          {!entries.length && <tr>
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
    {transfer && <TransferSum suggestion={transfer} ledger={data.ledger} view={view} />}
    <OpenBillsNote data={data} />
  </>;
}

// "Between them directly: $60.79 + $19.92 passed along = $80.71." and the reason.
function TransferSum({ suggestion, ledger, view }: { suggestion: Suggestion; ledger: GroupLedger; view: GroupView }) {
  const { directCents, passedAlongCents: passed } = suggestion.explanation;
  const reason = transferReason(suggestion, ledger, view);
  return <p className="ledger-trace-transfer">
    Between them directly: <b>{minus(directCents)}</b>
    {passed > 0 ? <> + <b>{money(passed)}</b> passed along</> : passed < 0 ? <> − <b>{money(-passed)}</b> sent elsewhere</> : null}
    {' '}= <b>{money(suggestion.amountCents)}</b>.{reason && ` ${reason}`}
  </p>;
}

// PROTOTYPE (throwaway): "How is this number calculated?" for Everyone's balance
// and Suggested transfers. Three desktop variants (hover) and three mobile variants
// (tap), switchable with ?desktop=A|B|C and ?mobile=A|B|C and the floating bar.
// Mounted inside GroupPage's "Group balances & repayments" card in dev builds only.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { money } from '../bill-api';
import type { GroupPageData, GroupView } from '../group-view';
import { Avatar, Icon } from '../ui';
import {
  date, memberBreakdown, relations, transferBreakdown, withRunning,
  type Line, type MemberBreakdown, type TransferBreakdown,
} from './balance-breakdown';
import './balance-breakdown.css';

type Subject =
  | { kind: 'member'; userId: string }
  | { kind: 'transfer'; fromId: string; toId: string; amountCents: number };
type Ctx = { data: GroupPageData; view: GroupView };

const subjectKey = (subject: Subject) => subject.kind === 'member' ? `m:${subject.userId}` : `t:${subject.fromId}:${subject.toId}`;
const signed = (cents: number) => `${cents > 0 ? '+' : cents < 0 ? '−' : ''}${money(Math.abs(cents))}`;
const tone = (cents: number) => cents > 0 ? 'group-tone-owed' : cents < 0 ? 'group-tone-owe' : '';
const shortDate = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

function namesFor({ view }: Ctx) {
  const full = (id: string) => view.members.find(member => member.userId === id)?.displayName ?? 'Member';
  const isMe = (id: string) => id === view.me.id;
  return {
    full,
    // Subject forms: "You" / "Carl Yan"; possessive: "Your" / "Carl's".
    who: (id: string) => isMe(id) ? 'You' : full(id),
    whose: (id: string) => isMe(id) ? 'Your' : `${full(id).split(' ')[0]}'s`,
    first: (id: string) => isMe(id) ? 'you' : full(id).split(' ')[0],
    isMe,
  };
}

// ---------------------------------------------------------------------------
// Shared row layout. Every variant reuses the same two lists so the comparison
// is about the explanation, not the ledger itself.

function LedgerColumns({ ctx, renderAmount, rowProps }: {
  ctx: Ctx;
  renderAmount: (subject: Subject, text: ReactNode, className: string) => ReactNode;
  rowProps?: (subject: Subject) => { className?: string; after?: ReactNode; onClick?: () => void };
}) {
  const { view } = ctx;
  const names = namesFor(ctx);
  const row = (subject: Subject, label: ReactNode, text: ReactNode, className: string) => {
    const extra = rowProps?.(subject);
    return <li key={subjectKey(subject)} className={extra?.className} onClick={extra?.onClick}>
      <div className="bd-row-main"><span>{label}</span>{renderAmount(subject, text, className)}</div>
      {extra?.after}
    </li>;
  };
  return <div className="group-audit-columns">
    <section aria-label="Everyone's balance">
      <h3>Everyone's balance</h3>
      <ul className="group-ledger-rows bd-rows">
        {view.members.map(member => row({ kind: 'member', userId: member.userId },
          <>{member.displayName}{names.isMe(member.userId) && ' (you)'}</>, signed(member.netCents), tone(member.netCents)))}
      </ul>
    </section>
    <section aria-label="Suggested transfers">
      <h3>Suggested transfers</h3>
      <ul className="group-ledger-rows bd-rows">
        {view.suggestions.map(suggestion => row(
          { kind: 'transfer', fromId: suggestion.fromUserId, toId: suggestion.toUserId, amountCents: suggestion.amountCents },
          <>{view.name(suggestion.fromUserId)} → {view.name(suggestion.toUserId)}</>, money(suggestion.amountCents), ''))}
      </ul>
    </section>
  </div>;
}

// ---------------------------------------------------------------------------
// Explanation bodies.

function lineTitle(line: Line, ctx: Ctx) {
  const names = namesFor(ctx);
  if (line.kind === 'bill') return line.bill.title;
  return line.netCents > 0 ? `Repayment to ${names.full(line.counterpartyId)}` : `Repayment from ${names.full(line.counterpartyId)}`;
}
function lineDetail(line: Line, ctx: Ctx, userId: string) {
  const names = namesFor(ctx);
  if (line.kind === 'repayment') return 'Confirmed by recipient';
  const parts: string[] = [];
  if (line.paidCents) parts.push(`${names.who(userId)} paid ${money(line.paidCents)}`);
  parts.push(`${names.whose(userId)} share ${money(line.shareCents)}`);
  if (line.adjustmentCents) parts.push(`${line.adjustmentCents > 0 ? '+' : '−'}${money(Math.abs(line.adjustmentCents))} difference`);
  return parts.join(' · ');
}

function UncountedNote({ breakdown }: { breakdown: MemberBreakdown }) {
  if (!breakdown.uncounted.length) return null;
  return <p className="bd-note"><Icon name="clock" size={13} />Not counted yet: {breakdown.uncounted.map(bill => bill.title).join(', ')} (still open)</p>;
}

// Receipt-style list: one line per bill or repayment, totalled at the bottom.
function ReceiptMember({ ctx, userId }: { ctx: Ctx; userId: string }) {
  const names = namesFor(ctx);
  const breakdown = memberBreakdown(ctx.data, userId);
  const bills = breakdown.lines.filter(line => line.kind === 'bill').length;
  const repayments = breakdown.lines.length - bills;
  return <div className="bd-receipt">
    <header className="bd-head">
      <Avatar name={names.full(userId)} small />
      <div><small>{names.whose(userId)} balance</small><strong className={tone(breakdown.totalCents)}>{signed(breakdown.totalCents)}</strong></div>
    </header>
    <p className="bd-sub">From {plural(bills, 'completed bill')}{repayments ? ` and ${plural(repayments, 'confirmed repayment')}` : ''}. Each bill adds what {names.first(userId)} paid and subtracts {names.isMe(userId) ? 'your' : 'their'} share.</p>
    <ol className="bd-lines">
      {breakdown.lines.map(line => <li key={line.key}>
        <span className="bd-line-icon" aria-hidden="true"><Icon name={line.kind === 'bill' ? 'basket' : 'arrows'} size={14} /></span>
        <span className="bd-line-text">
          {line.kind === 'bill' ? <a href={`#/bills/${line.bill.id}`}>{lineTitle(line, ctx)}</a> : <b>{lineTitle(line, ctx)}</b>}
          <small>{shortDate(date(line))} · {lineDetail(line, ctx, userId)}</small>
        </span>
        <strong className={tone(line.netCents)}>{signed(line.netCents)}</strong>
      </li>)}
    </ol>
    <div className="bd-total"><span>Balance</span><strong className={tone(breakdown.totalCents)}>{signed(breakdown.totalCents)}</strong></div>
    <UncountedNote breakdown={breakdown} />
  </div>;
}

function routedStory(ctx: Ctx, fromId: string, toId: string, breakdown: TransferBreakdown) {
  const names = namesFor(ctx);
  const { routedCents, others } = breakdown;
  if (!routedCents) return null;
  if (routedCents > 0) {
    const via = others.find(relation => relation.toId === toId && others.some(other => other.fromId === fromId && other.toId === relation.fromId));
    if (via) return <>{names.who(via.fromId)} owed {names.first(toId)} {money(routedCents)}. {names.who(fromId)} owes {names.first(via.fromId)} more than that, so {names.first(fromId)} pays it to {names.first(toId)} directly — one fewer transfer.</>;
    return <>{money(routedCents)} of other debts is passed along to {names.first(toId)} so the group needs fewer transfers.</>;
  }
  const via = others.find(relation => relation.fromId === toId);
  if (via) return <>{names.who(toId)} owed {names.first(via.toId)} {money(-routedCents)}. {names.who(fromId)} pays that to {names.first(via.toId)} instead, so {names.first(toId)} receives {money(-routedCents)} less here.</>;
  return <>{money(-routedCents)} is sent elsewhere so the group needs fewer transfers.</>;
}

function ReceiptTransfer({ ctx, fromId, toId, amountCents }: { ctx: Ctx; fromId: string; toId: string; amountCents: number }) {
  const names = namesFor(ctx);
  const breakdown = transferBreakdown(ctx.data, fromId, toId, amountCents);
  const { direct, routedCents, others } = breakdown;
  return <div className="bd-receipt">
    <header className="bd-head bd-head-transfer">
      <span className="bd-pair"><Avatar name={names.full(fromId)} small /><Icon name="right" size={14} /><Avatar name={names.full(toId)} small /></span>
      <div><small>{names.who(fromId)} pays {names.first(toId)}</small><strong>{money(amountCents)}</strong></div>
    </header>
    <h4 className="bd-step"><span>1</span>Between {names.first(fromId)} and {names.first(toId)} on bills</h4>
    <ol className="bd-lines">
      {direct.lines.map(line => <li key={line.key}>
        <span className="bd-line-icon" aria-hidden="true"><Icon name={line.bill ? 'basket' : 'arrows'} size={14} /></span>
        <span className="bd-line-text">
          {line.bill ? <a href={`#/bills/${line.bill.id}`}>{line.label}</a> : <b>{line.label}</b>}
          <small>{shortDate(line.date)} · {line.bill
            ? line.bill.initiatorId === toId ? `${names.whose(fromId)} share of ${names.first(toId)}'s bill` : `${names.whose(toId)} share of ${names.first(fromId)}'s bill`
            : line.cents < 0 ? `${names.who(fromId)} → ${names.first(toId)}, confirmed` : `${names.who(toId)} → ${names.first(fromId)}, confirmed`}</small>
        </span>
        <strong>{signed(line.cents)}</strong>
      </li>)}
    </ol>
    <div className="bd-subtotal"><span>{names.who(fromId)} owes {names.first(toId)} directly</span><strong>{money(direct.totalCents)}</strong></div>
    {routedCents !== 0 && <>
      <h4 className="bd-step"><span>2</span>Simplified with other debts</h4>
      <div className="bd-chips">{others.map(relation => <span key={`${relation.fromId}:${relation.toId}`} className="bd-chip">
        {names.who(relation.fromId)} → {names.first(relation.toId)} <b>{money(relation.cents)}</b></span>)}</div>
      <p className="bd-story">{routedStory(ctx, fromId, toId, breakdown)}</p>
      <div className="bd-subtotal"><span>{routedCents > 0 ? 'Passed along' : 'Sent elsewhere'}</span><strong>{signed(routedCents)}</strong></div>
    </>}
    <div className="bd-total"><span>Suggested transfer</span><strong>{money(amountCents)}</strong></div>
    <p className="bd-note">{names.whose(fromId)} whole balance is {signed(breakdown.fromNet)}: {breakdown.fromSuggestions.map(suggestion => `${money(suggestion.amountCents)} to ${names.first(suggestion.toUserId)}`).join(', ')}.</p>
  </div>;
}

function ReceiptBody({ ctx, subject }: { ctx: Ctx; subject: Subject }) {
  return subject.kind === 'member' ? <ReceiptMember ctx={ctx} userId={subject.userId} />
    : <ReceiptTransfer ctx={ctx} {...subject} />;
}

// ---------------------------------------------------------------------------
// Hover popover machinery (desktop A and B).

function useHoverPopover() {
  const [state, setState] = useState<{ subject: Subject; rect: DOMRect; pinned: boolean } | null>(null);
  const timer = useRef<number>(0);
  const clear = () => window.clearTimeout(timer.current);
  const api = {
    state,
    enter(subject: Subject, element: HTMLElement) {
      clear();
      if (state?.pinned) return;
      timer.current = window.setTimeout(() => setState({ subject, rect: element.getBoundingClientRect(), pinned: false }), state ? 0 : 140);
    },
    leave() { clear(); if (!state?.pinned) timer.current = window.setTimeout(() => setState(null), 180); },
    keep() { clear(); },
    pin(subject: Subject, element: HTMLElement) {
      clear();
      setState(current => current?.pinned && subjectKey(current.subject) === subjectKey(subject) ? null
        : { subject, rect: element.getBoundingClientRect(), pinned: true });
    },
    close() { clear(); setState(null); },
  };
  useEffect(() => {
    if (!state) return;
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') setState(null); };
    const down = (event: MouseEvent) => {
      if (state.pinned && !(event.target as Element).closest('.bd-popover, .bd-trigger')) setState(null);
    };
    const scroll = () => { if (!state.pinned) setState(null); };
    window.addEventListener('keydown', key);
    window.addEventListener('mousedown', down);
    window.addEventListener('scroll', scroll, { passive: true });
    return () => { window.removeEventListener('keydown', key); window.removeEventListener('mousedown', down); window.removeEventListener('scroll', scroll); };
  }, [state]);
  return api;
}

function Trigger({ subject, popover, className, children }: {
  subject: Subject; popover: ReturnType<typeof useHoverPopover>; className: string; children: ReactNode;
}) {
  const active = popover.state && subjectKey(popover.state.subject) === subjectKey(subject);
  return <button type="button" className={`bd-trigger ${className}${active ? ' bd-active' : ''}`}
    aria-expanded={!!active} aria-haspopup="dialog"
    onMouseEnter={event => popover.enter(subject, event.currentTarget)}
    onMouseLeave={popover.leave}
    onFocus={event => popover.enter(subject, event.currentTarget)}
    onBlur={popover.leave}
    onClick={event => popover.pin(subject, event.currentTarget)}>
    {children}
  </button>;
}

function Popover({ popover, width, children }: { popover: ReturnType<typeof useHoverPopover>; width: number; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number; above: boolean } | null>(null);
  const rect = popover.state!.rect;
  useLayoutEffect(() => {
    const height = ref.current!.offsetHeight;
    const below = rect.bottom + 10;
    const above = below + height > window.innerHeight - 12 && rect.top - height - 10 > 12;
    const left = Math.max(12, Math.min(rect.right - width + 8, window.innerWidth - width - 12));
    setPosition({ left, top: above ? rect.top - height - 10 : Math.min(below, Math.max(12, window.innerHeight - height - 12)), above });
  }, [rect, width, children]);
  return <div ref={ref} role="dialog" className={`bd-popover${popover.state!.pinned ? ' bd-pinned' : ''}`}
    style={{ width, left: position?.left ?? -9999, top: position?.top ?? 0 }}
    onMouseEnter={popover.keep} onMouseLeave={popover.leave}>
    {children}
    <p className="bd-hint">{popover.state!.pinned ? 'Pinned · Esc or click outside to close' : 'Click the amount to pin'}</p>
  </div>;
}

// ---------------------------------------------------------------------------
// Desktop A — receipt popover.

function DesktopA({ ctx }: { ctx: Ctx }) {
  const popover = useHoverPopover();
  return <>
    <LedgerColumns ctx={ctx} renderAmount={(subject, text, className) =>
      <Trigger subject={subject} popover={popover} className={className}>{text}</Trigger>} />
    {popover.state && <Popover popover={popover} width={400}><ReceiptBody ctx={ctx} subject={popover.state.subject} /></Popover>}
  </>;
}

// ---------------------------------------------------------------------------
// Desktop B — chart popover: waterfall for balances, before/after network for transfers.

function Waterfall({ ctx, userId }: { ctx: Ctx; userId: string }) {
  const names = namesFor(ctx);
  const breakdown = memberBreakdown(ctx.data, userId);
  const steps = withRunning(breakdown.lines);
  const extent = Math.max(1, ...steps.flatMap(step => [Math.abs(step.start), Math.abs(step.end)]));
  const min = Math.min(0, ...steps.map(step => Math.min(step.start, step.end)));
  const max = Math.max(0, ...steps.map(step => Math.max(step.start, step.end)));
  const span = Math.max(max - min, extent * 0.1);
  const x = (cents: number) => ((cents - min) / span) * 100;
  return <div className="bd-chart">
    <header className="bd-head">
      <Avatar name={names.full(userId)} small />
      <div><small>How {names.whose(userId).toLowerCase() === 'your' ? 'your' : names.whose(userId)} balance builds up</small><strong className={tone(breakdown.totalCents)}>{signed(breakdown.totalCents)}</strong></div>
    </header>
    <div className="bd-wf">
      {steps.map(({ line, start, end }) => <div className="bd-wf-row" key={line.key}>
        <span className="bd-wf-label">{line.kind === 'bill' ? <a href={`#/bills/${line.bill.id}`}>{line.bill.title}</a> : <b>{lineTitle(line, ctx)}</b>}<small>{shortDate(date(line))}</small></span>
        <span className="bd-wf-track">
          <span className="bd-wf-zero" style={{ left: `${x(0)}%` }} />
          <span className={`bd-wf-bar ${line.netCents >= 0 ? 'up' : 'down'}`} style={{ left: `${x(Math.min(start, end))}%`, width: `${Math.max(0.8, x(Math.max(start, end)) - x(Math.min(start, end)))}%` }} />
        </span>
        <strong className={tone(line.netCents)}>{signed(line.netCents)}</strong>
      </div>)}
      <div className="bd-wf-row bd-wf-final">
        <span className="bd-wf-label"><b>Balance</b></span>
        <span className="bd-wf-track">
          <span className="bd-wf-zero" style={{ left: `${x(0)}%` }} />
          <span className={`bd-wf-bar total ${breakdown.totalCents >= 0 ? 'up' : 'down'}`} style={{ left: `${x(Math.min(0, breakdown.totalCents))}%`, width: `${Math.max(0.8, Math.abs(x(breakdown.totalCents) - x(0)))}%` }} />
        </span>
        <strong className={tone(breakdown.totalCents)}>{signed(breakdown.totalCents)}</strong>
      </div>
    </div>
    <p className="bd-legend"><i className="up" />paid more than {names.isMe(userId) ? 'your' : 'their'} share <i className="down" />share of someone else's bill, or repayment</p>
    <UncountedNote breakdown={breakdown} />
  </div>;
}

function Network({ ctx, edges, highlight, title }: {
  ctx: Ctx; edges: { fromId: string; toId: string; cents: number }[]; highlight?: string; title: string;
}) {
  const names = namesFor(ctx);
  const ids = ctx.view.members.map(member => member.userId);
  const size = 190; const radius = 62; const c = size / 2;
  const at = (id: string) => {
    const angle = -Math.PI / 2 + (ids.indexOf(id) / ids.length) * Math.PI * 2;
    return { x: c + radius * Math.cos(angle), y: c + 6 + radius * Math.sin(angle) };
  };
  return <figure className="bd-net">
    <figcaption>{title}</figcaption>
    <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label={title}>
      <defs><marker id="bd-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="context-stroke" /></marker></defs>
      {edges.map(edge => {
        const a = at(edge.fromId); const b = at(edge.toId);
        const dx = b.x - a.x; const dy = b.y - a.y; const length = Math.hypot(dx, dy);
        const ux = dx / length; const uy = dy / length; const pad = 19;
        const key = `${edge.fromId}:${edge.toId}`;
        const mx = (a.x + b.x) / 2 - uy * 12; const my = (a.y + b.y) / 2 + ux * 12;
        return <g key={key} className={`bd-edge${highlight === key ? ' hot' : ''}`}>
          <path d={`M${a.x + ux * pad},${a.y + uy * pad} Q${mx},${my} ${b.x - ux * pad},${b.y - uy * pad}`} markerEnd="url(#bd-arrow)" />
          <text x={(a.x + b.x) / 2 - uy * 20} y={(a.y + b.y) / 2 + ux * 20 + 3} textAnchor="middle">{money(edge.cents)}</text>
        </g>;
      })}
      {ids.map(id => { const p = at(id); return <g key={id} className="bd-node">
        <circle cx={p.x} cy={p.y} r={16} />
        <text x={p.x} y={p.y + 4} textAnchor="middle">{names.isMe(id) ? 'You' : names.full(id).slice(0, 1)}</text>
      </g>; })}
    </svg>
  </figure>;
}

function NetworkTransfer({ ctx, fromId, toId, amountCents }: { ctx: Ctx; fromId: string; toId: string; amountCents: number }) {
  const names = namesFor(ctx);
  const breakdown = transferBreakdown(ctx.data, fromId, toId, amountCents);
  const before = relations(ctx.data);
  const after = ctx.view.suggestions.map(suggestion => ({ fromId: suggestion.fromUserId, toId: suggestion.toUserId, cents: suggestion.amountCents }));
  const key = `${fromId}:${toId}`;
  return <div className="bd-chart">
    <header className="bd-head bd-head-transfer">
      <span className="bd-pair"><Avatar name={names.full(fromId)} small /><Icon name="right" size={14} /><Avatar name={names.full(toId)} small /></span>
      <div><small>{names.who(fromId)} pays {names.first(toId)}</small><strong>{money(amountCents)}</strong></div>
    </header>
    <div className="bd-nets">
      <Network ctx={ctx} title={`What bills say (${before.length} debts)`} edges={before} highlight={key} />
      <span className="bd-nets-arrow" aria-hidden="true"><Icon name="right" size={16} /></span>
      <Network ctx={ctx} title={`Fewest transfers (${after.length})`} edges={after} highlight={key} />
    </div>
    <div className="bd-equation">
      <span><b>{money(breakdown.direct.totalCents)}</b><small>direct, {plural(breakdown.direct.lines.length, 'item')}</small></span>
      {breakdown.routedCents !== 0 && <><i>{breakdown.routedCents > 0 ? '+' : '−'}</i>
        <span><b>{money(Math.abs(breakdown.routedCents))}</b><small>{breakdown.routedCents > 0 ? 'passed along' : 'sent elsewhere'}</small></span></>}
      <i>=</i>
      <span className="bd-eq-total"><b>{money(amountCents)}</b><small>transfer</small></span>
    </div>
    <p className="bd-story">{routedStory(ctx, fromId, toId, breakdown) ?? `This matches what ${names.first(fromId)} owes ${names.first(toId)} on their shared bills.`}</p>
  </div>;
}

function DesktopB({ ctx }: { ctx: Ctx }) {
  const popover = useHoverPopover();
  const subject = popover.state?.subject;
  return <>
    <LedgerColumns ctx={ctx} renderAmount={(subject, text, className) =>
      <Trigger subject={subject} popover={popover} className={className}>{text}</Trigger>} />
    {subject && <Popover popover={popover} width={subject.kind === 'member' ? 460 : 480}>
      {subject.kind === 'member' ? <Waterfall ctx={ctx} userId={subject.userId} /> : <NetworkTransfer ctx={ctx} {...subject} />}
    </Popover>}
  </>;
}

// ---------------------------------------------------------------------------
// Desktop C — docked ledger: one bills × members table under the lists; hovering
// any amount highlights the column(s) and cells that produce it.

function DesktopC({ ctx }: { ctx: Ctx }) {
  const names = namesFor(ctx);
  const [hover, setHover] = useState<Subject | null>(null);
  const [pinned, setPinned] = useState<Subject | null>(null);
  // Collapsed by default. Hover only traces once the table is open, so the card
  // below never jumps; clicking a figure opens the table and pins that figure.
  const [expanded, setExpanded] = useState(false);
  const active = expanded ? pinned ?? hover : null;
  const members = ctx.view.members;
  const perMember = new Map(members.map(member => [member.userId, memberBreakdown(ctx.data, member.userId)]));
  const rows = [...new Map([...perMember.values()].flatMap(breakdown => breakdown.lines).map(line => [line.key, line])).values()]
    .sort((a, b) => date(a).localeCompare(date(b)));
  const cell = (userId: string, key: string) => perMember.get(userId)!.lines.find(line => line.key === key)?.netCents;
  const hot = (userId: string) => !!active && (active.kind === 'member' ? active.userId === userId : active.fromId === userId || active.toId === userId);
  const transfer = active?.kind === 'transfer' ? transferBreakdown(ctx.data, active.fromId, active.toId, active.amountCents) : null;
  const directKeys = new Set(transfer?.direct.lines.map(line => line.key));
  const rowHot = (key: string) => active?.kind === 'member' ? cell(active.userId, key) !== undefined : transfer ? directKeys.has(key) : false;
  const uncounted = ctx.data.bills.filter(bill => bill.completedAt === null && bill.canceledAt === null);
  return <>
    <LedgerColumns ctx={ctx} renderAmount={(subject, text, className) => {
      const isActive = active && subjectKey(active) === subjectKey(subject);
      return <button type="button" className={`bd-trigger ${className}${isActive ? ' bd-active' : ''}`}
        title={expanded ? undefined : 'Show how this adds up'} aria-controls="bd-dock-table"
        onMouseEnter={() => setHover(subject)} onMouseLeave={() => setHover(null)}
        onFocus={() => setHover(subject)} onBlur={() => setHover(null)}
        onClick={() => {
          if (!expanded) { setExpanded(true); setPinned(subject); return; }
          setPinned(current => current && subjectKey(current) === subjectKey(subject) ? null : subject);
        }}>{text}</button>;
    }} rowProps={subject => ({ className: active && subjectKey(active) === subjectKey(subject) ? 'bd-row-active' : '' })} />
    <section className={`bd-dock${active ? ' bd-dock-on' : ''}${expanded ? '' : ' bd-dock-collapsed'}`} aria-label="How the balances add up">
      <header>
        <button type="button" className="bd-dock-toggle" aria-expanded={expanded} aria-controls="bd-dock-table"
          onClick={() => { setExpanded(value => !value); setPinned(null); }}>
          <h3>How the numbers add up</h3>
          <span className={`bd-chevron${expanded ? ' open' : ''}`}><Icon name="down" size={16} /></span>
        </button>
        {expanded && <p>{!active ? 'Hover any balance or transfer above to trace it. Click to keep it highlighted.'
          : active.kind === 'member' ? <>Reading down <b>{names.isMe(active.userId) ? 'your' : names.whose(active.userId)}</b> column: each bill adds what they paid and subtracts their share.</>
            : <>Transfer from <b>{names.who(active.fromId)}</b> to <b>{names.first(active.toId)}</b> settles both columns. Highlighted rows are the bills between them.</>}
          {pinned && <button type="button" className="bd-unpin" onClick={() => setPinned(null)}>Unpin</button>}</p>}
      </header>
      {expanded && <div id="bd-dock-table">
      <table className={`bd-matrix${active ? ' bd-matrix-active' : ''}`}>
        <thead><tr><th>Bill or repayment</th>{members.map(member => <th key={member.userId} className={hot(member.userId) ? 'hot' : ''}>
          <span className="bd-col-head">{names.isMe(member.userId) ? 'You' : member.displayName.split(' ')[0]}
            {hot(member.userId) && <small>{active?.kind === 'transfer' ? active.fromId === member.userId ? 'pays' : 'receives' : 'balance'}</small>}</span>
        </th>)}</tr></thead>
        <tbody>
          {rows.map(line => <tr key={line.key} className={rowHot(line.key) ? 'hot-row' : active ? 'dim-row' : ''}>
            <th scope="row"><span className="bd-row-label">{line.kind === 'bill' ? <a href={`#/bills/${line.bill.id}`}>{line.bill.title}</a> : <span>Repayment · {names.who(line.repayment.senderId)} → {names.first(line.repayment.recipientId)}</span>}
              <small>{shortDate(date(line))}{line.kind === 'bill' && ` · paid by ${names.first(line.bill.initiatorId)} · ${money(line.bill.totalCents)}`}</small></span></th>
            {members.map(member => { const value = cell(member.userId, line.key); return <td key={member.userId} className={`${hot(member.userId) ? 'hot' : ''} ${tone(value ?? 0)}`}>{value === undefined ? '—' : signed(value)}</td>; })}
          </tr>)}
        </tbody>
        <tfoot><tr><th scope="row">Balance</th>{members.map(member => <td key={member.userId} className={`${hot(member.userId) ? 'hot' : ''} ${tone(member.netCents)}`}>{signed(member.netCents)}</td>)}</tr></tfoot>
      </table>
      {transfer && active?.kind === 'transfer' && <p className="bd-dock-transfer">
        Between them directly: <b>{money(transfer.direct.totalCents)}</b>
        {transfer.routedCents !== 0 && <> {transfer.routedCents > 0 ? '+' : '−'} <b>{money(Math.abs(transfer.routedCents))}</b> {transfer.routedCents > 0 ? 'passed along' : 'sent elsewhere'} = <b>{money(active.amountCents)}</b>. {routedStory(ctx, active.fromId, active.toId, transfer)}</>}
      </p>}
      {uncounted.length > 0 && <p className="bd-note"><Icon name="clock" size={13} />Not counted yet: {uncounted.map(bill => bill.title).join(', ')} (still open)</p>}
      </div>}
    </section>
  </>;
}

// ---------------------------------------------------------------------------
// Mobile A — bottom sheet with the receipt body.

function MobileA({ ctx }: { ctx: Ctx }) {
  const [subject, setSubject] = useState<Subject | null>(null);
  return <>
    <LedgerColumns ctx={ctx} renderAmount={(_, text, className) => <strong className={`bd-tap ${className}`}>{text}<Icon name="right" size={14} /></strong>}
      rowProps={subject => ({ className: 'bd-tappable', onClick: () => setSubject(subject) })} />
    {subject && <div className="bd-sheet-backdrop" onClick={() => setSubject(null)}>
      <div className="bd-sheet" role="dialog" aria-modal="true" onClick={event => event.stopPropagation()}>
        <span className="bd-sheet-handle" aria-hidden="true" />
        <button type="button" className="bd-sheet-close" aria-label="Close" onClick={() => setSubject(null)}><Icon name="close" size={16} /></button>
        <ReceiptBody ctx={ctx} subject={subject} />
      </div>
    </div>}
  </>;
}

// ---------------------------------------------------------------------------
// Mobile B — inline accordion: the row expands in place with a compact list.

function CompactMember({ ctx, userId }: { ctx: Ctx; userId: string }) {
  const breakdown = memberBreakdown(ctx.data, userId);
  return <div className="bd-acc-body">
    {breakdown.lines.map(line => <div key={line.key} className="bd-acc-line">
      <span>{lineTitle(line, ctx)}<small>{lineDetail(line, ctx, userId)}</small></span>
      <b className={tone(line.netCents)}>{signed(line.netCents)}</b>
    </div>)}
    <div className="bd-acc-line bd-acc-sum"><span>= Balance</span><b className={tone(breakdown.totalCents)}>{signed(breakdown.totalCents)}</b></div>
    <UncountedNote breakdown={breakdown} />
  </div>;
}

function CompactTransfer({ ctx, fromId, toId, amountCents }: { ctx: Ctx; fromId: string; toId: string; amountCents: number }) {
  const names = namesFor(ctx);
  const breakdown = transferBreakdown(ctx.data, fromId, toId, amountCents);
  return <div className="bd-acc-body">
    {breakdown.direct.lines.map(line => <div key={line.key} className="bd-acc-line">
      <span>{line.label}<small>{line.bill ? (line.bill.initiatorId === toId ? `${names.whose(fromId)} share` : `${names.whose(toId)} share, owed back`) : 'Confirmed repayment'}</small></span>
      <b>{signed(line.cents)}</b>
    </div>)}
    {breakdown.routedCents !== 0 && <div className="bd-acc-line bd-acc-routed">
      <span>{breakdown.routedCents > 0 ? 'Passed along' : 'Sent elsewhere'}<small>{routedStory(ctx, fromId, toId, breakdown)}</small></span>
      <b>{signed(breakdown.routedCents)}</b>
    </div>}
    <div className="bd-acc-line bd-acc-sum"><span>= Suggested transfer</span><b>{money(amountCents)}</b></div>
  </div>;
}

function MobileB({ ctx }: { ctx: Ctx }) {
  const [open, setOpen] = useState<string | null>(null);
  return <LedgerColumns ctx={ctx}
    renderAmount={(subject, text, className) => <strong className={`bd-tap ${className}`}>{text}
      <span className={`bd-chevron${open === subjectKey(subject) ? ' open' : ''}`}><Icon name="down" size={14} /></span></strong>}
    rowProps={subject => {
      const key = subjectKey(subject);
      return {
        className: `bd-tappable${open === key ? ' bd-expanded' : ''}`,
        onClick: () => setOpen(current => current === key ? null : key),
        after: open === key ? (subject.kind === 'member' ? <CompactMember ctx={ctx} userId={subject.userId} /> : <CompactTransfer ctx={ctx} {...subject} />) : null,
      };
    }} />;
}

// ---------------------------------------------------------------------------
// Mobile C — full-screen drill-down page with a running-balance statement.

function StatementMember({ ctx, userId }: { ctx: Ctx; userId: string }) {
  const names = namesFor(ctx);
  const breakdown = memberBreakdown(ctx.data, userId);
  return <>
    <div className="bd-hero">
      <Avatar name={names.full(userId)} />
      <small>{names.whose(userId)} balance</small>
      <strong className={tone(breakdown.totalCents)}>{signed(breakdown.totalCents)}</strong>
      <p>{breakdown.totalCents > 0 ? `${names.who(userId)} ${names.isMe(userId) ? 'are' : 'is'} owed this by the group.` : breakdown.totalCents < 0 ? `${names.who(userId)} ${names.isMe(userId) ? 'owe' : 'owes'} this to the group.` : 'Settled up.'}</p>
    </div>
    <ol className="bd-statement">
      <li className="bd-st-start"><span>Start</span><b>{money(0)}</b></li>
      {withRunning(breakdown.lines).map(({ line, end: running }) => <li key={line.key}>
        <span className="bd-st-dot" aria-hidden="true" />
        <div className="bd-st-text">
          <small>{shortDate(date(line))}</small>
          {line.kind === 'bill' ? <a href={`#/bills/${line.bill.id}`}>{line.bill.title}</a> : <b>{lineTitle(line, ctx)}</b>}
          <small>{lineDetail(line, ctx, userId)}</small>
        </div>
        <div className="bd-st-amounts"><b className={tone(line.netCents)}>{signed(line.netCents)}</b><small>= {signed(running)}</small></div>
      </li>)}
    </ol>
    <UncountedNote breakdown={breakdown} />
  </>;
}

function StepsTransfer({ ctx, fromId, toId, amountCents }: { ctx: Ctx; fromId: string; toId: string; amountCents: number }) {
  const names = namesFor(ctx);
  const breakdown = transferBreakdown(ctx.data, fromId, toId, amountCents);
  return <>
    <div className="bd-hero">
      <span className="bd-pair"><Avatar name={names.full(fromId)} /><Icon name="right" size={18} /><Avatar name={names.full(toId)} /></span>
      <small>{names.who(fromId)} pays {names.first(toId)}</small>
      <strong>{money(amountCents)}</strong>
    </div>
    <ol className="bd-cards">
      <li><span className="bd-card-n">1</span><div>
        <b>{names.who(fromId)} {names.isMe(fromId) ? 'owe' : 'owes'} the group {money(-breakdown.fromNet)}</b>
        <p>{breakdown.fromSuggestions.length > 1 ? `Split into ${breakdown.fromSuggestions.length} transfers: ` : ''}{breakdown.fromSuggestions.map(suggestion => `${money(suggestion.amountCents)} to ${names.first(suggestion.toUserId)}`).join(' and ')}.</p>
      </div></li>
      <li><span className="bd-card-n">2</span><div>
        <b>Bills between {names.first(fromId)} and {names.first(toId)}: {money(breakdown.direct.totalCents)}</b>
        {breakdown.direct.lines.map(line => <div key={line.key} className="bd-acc-line"><span>{line.label}</span><b>{signed(line.cents)}</b></div>)}
      </div></li>
      {breakdown.routedCents !== 0 && <li><span className="bd-card-n">3</span><div>
        <b>{breakdown.routedCents > 0 ? 'Passed along' : 'Sent elsewhere'}: {signed(breakdown.routedCents)}</b>
        <p>{routedStory(ctx, fromId, toId, breakdown)}</p>
      </div></li>}
    </ol>
    <div className="bd-cards-total"><span>{money(breakdown.direct.totalCents)}{breakdown.routedCents !== 0 && ` ${breakdown.routedCents > 0 ? '+' : '−'} ${money(Math.abs(breakdown.routedCents))}`} =</span><span>{money(amountCents)}</span></div>
  </>;
}

function MobileC({ ctx }: { ctx: Ctx }) {
  const [subject, setSubject] = useState<Subject | null>(null);
  return <>
    <LedgerColumns ctx={ctx} renderAmount={(_, text, className) => <strong className={`bd-tap ${className}`}>{text}<Icon name="right" size={14} /></strong>}
      rowProps={subject => ({ className: 'bd-tappable', onClick: () => setSubject(subject) })} />
    {subject && <div className="bd-screen" role="dialog" aria-modal="true">
      <header className="bd-screen-bar">
        <button type="button" onClick={() => setSubject(null)}><Icon name="left" size={18} /> Balances</button>
        <span>{subject.kind === 'member' ? 'How it adds up' : 'Why this transfer'}</span>
      </header>
      <div className="bd-screen-body">
        {subject.kind === 'member' ? <StatementMember ctx={ctx} userId={subject.userId} /> : <StepsTransfer ctx={ctx} {...subject} />}
      </div>
    </div>}
  </>;
}

// ---------------------------------------------------------------------------
// Switcher.

const desktopVariants = { A: 'Receipt popover', B: 'Chart popover', C: 'Docked ledger' } as const;
const mobileVariants = { A: 'Bottom sheet', B: 'Inline accordion', C: 'Full-screen page' } as const;
type Key = keyof typeof desktopVariants;
const keys: Key[] = ['A', 'B', 'C'];
// Chosen direction: collapsed docked ledger on desktop, bottom sheet on mobile.
const defaults = { desktop: 'C', mobile: 'A' } as const;

function useParams() {
  const [search, setSearch] = useState(window.location.search);
  useEffect(() => {
    const changed = () => setSearch(window.location.search);
    window.addEventListener('popstate', changed);
    window.addEventListener('bd-params', changed);
    return () => { window.removeEventListener('popstate', changed); window.removeEventListener('bd-params', changed); };
  }, []);
  const params = new URLSearchParams(search);
  const set = (name: string, value: string | null) => {
    const next = new URLSearchParams(window.location.search);
    if (value === null) next.delete(name); else next.set(name, value);
    window.history.replaceState(null, '', `${window.location.pathname}?${next}${window.location.hash}`);
    window.dispatchEvent(new Event('bd-params'));
  };
  return { params, set };
}

function useNarrow() {
  const query = '(max-width: 640px)';
  const [narrow, setNarrow] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const changed = () => setNarrow(media.matches);
    media.addEventListener('change', changed);
    return () => media.removeEventListener('change', changed);
  }, []);
  return narrow;
}

function Switcher({ narrow }: { narrow: boolean }) {
  const { params, set } = useParams();
  const phone = !narrow && params.get('phone') === '1';
  const dimension = narrow || phone ? 'mobile' : 'desktop';
  const current = (params.get(dimension) ?? defaults[dimension]) as Key;
  const labels = dimension === 'mobile' ? mobileVariants : desktopVariants;
  const cycle = (step: number) => set(dimension, keys[(keys.indexOf(current) + step + keys.length) % keys.length]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest('input, textarea, [contenteditable="true"]')) return;
      if (event.key === 'ArrowLeft') cycle(-1);
      if (event.key === 'ArrowRight') cycle(1);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });
  return <div className="bd-switcher" role="toolbar" aria-label="Prototype variants">
    {!narrow && <span className="bd-switcher-mode">
      <button type="button" className={!phone ? 'on' : ''} onClick={() => set('phone', null)}>Desktop</button>
      <button type="button" className={phone ? 'on' : ''} onClick={() => set('phone', '1')}>Mobile</button>
    </span>}
    <button type="button" aria-label="Previous variant" onClick={() => cycle(-1)}>‹</button>
    <span className="bd-switcher-label">{dimension === 'mobile' ? 'Mobile' : 'Desktop'} {current} · {labels[current]}</span>
    <button type="button" aria-label="Next variant" onClick={() => cycle(1)}>›</button>
  </div>;
}

function PhoneFrame() {
  const { params } = useParams();
  const src = new URL(window.location.href);
  src.searchParams.set('embed', '1');
  src.searchParams.delete('phone');
  return <div className="bd-phone-stage">
    <div className="bd-phone">
      <iframe key={params.get('mobile') ?? defaults.mobile} title="Mobile preview" src={src.toString()} />
    </div>
    <p>390 × 780 · scrolled to the balances card. Tap a row.</p>
  </div>;
}

export function BalanceBreakdownPrototype({ data, view }: Ctx) {
  const narrow = useNarrow();
  const { params } = useParams();
  const embedded = params.get('embed') === '1';
  const ctx = { data, view };
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (embedded) ref.current?.closest('.group-audit')?.scrollIntoView({ block: 'start' }); }, [embedded]);
  const desktop = (params.get('desktop') ?? defaults.desktop) as Key;
  const mobile = (params.get('mobile') ?? defaults.mobile) as Key;
  const body = narrow
    ? mobile === 'B' ? <MobileB ctx={ctx} /> : mobile === 'C' ? <MobileC ctx={ctx} /> : <MobileA ctx={ctx} />
    : desktop === 'B' ? <DesktopB ctx={ctx} /> : desktop === 'C' ? <DesktopC ctx={ctx} /> : <DesktopA ctx={ctx} />;
  return <div ref={ref} className="bd-proto">
    {body}
    {!embedded && !narrow && params.get('phone') === '1' && <PhoneFrame />}
    {import.meta.env.DEV && !embedded && <Switcher narrow={narrow} />}
  </div>;
}

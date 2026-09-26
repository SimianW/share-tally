// PROTOTYPE ONLY (issue #82): three structurally different Home layouts on #/prototype/home?variant=A|B|C.
// Mock data, no auth, no API. Throw away once a variant wins.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Avatars, Button, Icon, Logo } from '../ui';
import { PrototypeSwitcher } from '../PrototypeSwitcher';
import '../play.css';
import './prototype-home.css';

type Group = { id: string; name: string; emoji: string; members: string[]; netCents: number };
type Action =
  | { kind: 'missing-share' | 'confirm-share' | 'claim-items' | 'confirm-items'; groupId: string; title: string; amountCents: number | null }
  | { kind: 'review-repayment'; groupId: string; sender: string; amountCents: number }
  | { kind: 'draft-ready' | 'draft-fallback'; groupId: string; title: string };

const GROUPS: Group[] = [
  { id: 'costco', name: 'Costco Crew', emoji: '🛒', members: ['Simon', 'Emma', 'Alex', 'Jamie'], netCents: 8640 },
  { id: 'home', name: 'Roommates', emoji: '🏠', members: ['Simon', 'Riley', 'Jamie'], netCents: -4215 },
  { id: 'ski', name: 'Whistler ski trip', emoji: '⛷️', members: ['Simon', 'Emma', 'Alex', 'Riley', 'Jamie', 'Sam'], netCents: 0 },
  { id: 'books', name: 'Book club', emoji: '📚', members: ['Simon', 'Emma'], netCents: 1250 },
];

// Already in the agreed order: shares, then incoming transfers, then drafts.
const ACTIONS: Action[] = [
  { kind: 'missing-share', groupId: 'home', title: 'Hydro bill · September', amountCents: null },
  { kind: 'claim-items', groupId: 'costco', title: 'Costco run · Sep 24', amountCents: null },
  { kind: 'confirm-items', groupId: 'costco', title: 'Costco run · Sep 18', amountCents: 2347 },
  { kind: 'review-repayment', groupId: 'costco', sender: 'Emma', amountCents: 4000 },
  { kind: 'draft-ready', groupId: 'costco', title: 'Costco receipt · 38 items read' },
  { kind: 'draft-fallback', groupId: 'home', title: "T&T receipt · couldn't be read" },
];

type DataState = 'busy' | 'caught-up' | 'no-groups' | 'loading';
const DATA_STATES: DataState[] = ['busy', 'caught-up', 'no-groups', 'loading'];

const money = (cents: number) => `$${(Math.abs(cents) / 100).toFixed(2)}`;
const group = (id: string) => GROUPS.find(g => g.id === id)!;
const countFor = (actions: Action[], id: string) => actions.filter(a => a.groupId === id).length;

function balance(cents: number) {
  if (cents === 0) return { label: 'Settled', tone: 'settled' };
  return cents < 0 ? { label: `You owe ${money(cents)}`, tone: 'owe' } : { label: `You're owed ${money(cents)}`, tone: 'owed' };
}

type Kind = 'share' | 'repayment' | 'draft';
function actionCopy(a: Action): { verb: string; detail: string; amount: number | null; type: Kind } {
  switch (a.kind) {
    case 'missing-share': return { verb: 'Enter your share', detail: a.title, amount: null, type: 'share' };
    case 'confirm-share': return { verb: 'Confirm your share', detail: a.title, amount: a.amountCents, type: 'share' };
    case 'claim-items': return { verb: 'Claim your items', detail: a.title, amount: null, type: 'share' };
    case 'confirm-items': return { verb: 'Confirm your items', detail: a.title, amount: a.amountCents, type: 'share' };
    case 'review-repayment': return { verb: 'Review incoming transfer', detail: `From ${a.sender}`, amount: a.amountCents, type: 'repayment' };
    case 'draft-ready': return { verb: 'Review your receipt draft', detail: a.title, amount: null, type: 'draft' };
    case 'draft-fallback': return { verb: 'Enter items manually', detail: a.title, amount: null, type: 'draft' };
  }
}
const TYPE_ICON = { share: 'receipt', repayment: 'arrows', draft: 'clock' } as const;
const TYPE_LABEL = { share: 'Your shares', repayment: 'Incoming transfers', draft: 'Your drafts' } as const;

// ---------- hash routing for the prototype ----------
function useHash() {
  return useSyncExternalStore(cb => { window.addEventListener('hashchange', cb); return () => window.removeEventListener('hashchange', cb); }, () => window.location.hash);
}
function parse(hash: string) {
  const [path, query = ''] = hash.replace(/^#/, '').split('?');
  return { groupId: path.match(/^\/prototype\/home\/group\/(.+)$/)?.[1] ?? null, params: new URLSearchParams(query) };
}
function go(path: string, params: URLSearchParams) { window.location.hash = `${path}?${params}`; }

// ---------- shared chrome (decided: top bar, no sidebar) ----------
function TopBar({ params }: { params: URLSearchParams }) {
  return <header className="proto-topbar">
    <button className="proto-logo" onClick={() => go('/prototype/home', params)} aria-label="ShareTally home"><Logo /></button>
    <button className="proto-avatar-menu" aria-label="Account menu"><span className="avatar" style={{ ['--avatar-color' as string]: '#e5edc5' }}>S</span><Icon name="down" size={16} /></button>
  </header>;
}

function Heading({ state, count }: { state: DataState; count: number }) {
  return <div className="proto-heading">
    <div>
      <div className="eyebrow">YOUR SHARED PURCHASES</div>
      {state === 'loading'
        ? <div className="proto-skel proto-skel-title" aria-label="Loading" />
        : <h1>Hey Simon, {count > 0 ? <span>{count} {count === 1 ? 'thing needs' : 'things need'} you</span> : <span>you're all caught up <Icon name="check" size={26} /></span>}</h1>}
    </div>
    <Button><Icon name="plus" />New group</Button>
  </div>;
}

function NoGroups() {
  return <section className="proto-empty">
    <span className="proto-empty-emoji">👋</span>
    <h2>Your people, together.</h2>
    <p>Create a group to start recording shared purchases.</p>
    <Button><Icon name="plus" />Create your first group</Button>
    <p className="proto-hint">Joining friends? Ask them to send you their group's invitation link.</p>
  </section>;
}

const openGroup = (id: string, params: URLSearchParams) => go(`/prototype/home/group/${id}`, params);
type VariantProps = { state: DataState; actions: Action[]; params: URLSearchParams };

// ---------- Variant A: stacked inbox card over a card grid ----------
function VariantA({ state, actions, params }: VariantProps) {
  if (state === 'no-groups') return <NoGroups />;
  return <>
    {state === 'loading' ? <div className="proto-skel proto-skel-block" /> : actions.length > 0 && <section className="proto-a-inbox">
      <h2>Needs you</h2>
      <ul>{actions.map((a, i) => { const c = actionCopy(a); const g = group(a.groupId); return <li key={i}><button onClick={() => openGroup(a.groupId, params)}>
        <span className={`proto-type proto-type-${c.type}`}><Icon name={TYPE_ICON[c.type]} size={18} /></span>
        <span className="proto-a-text"><strong>{c.verb}</strong><small>{g.emoji} {g.name} · {c.detail}</small></span>
        <span className="proto-a-amount">{c.amount !== null && money(c.amount)} <span aria-hidden="true">→</span></span>
      </button></li>; })}</ul>
    </section>}
    <h2 className="proto-section-title">Your groups</h2>
    <div className="proto-a-grid">
      {GROUPS.map(g => { const b = balance(g.netCents); const n = countFor(actions, g.id); return <button key={g.id} className="proto-a-card" onClick={() => openGroup(g.id, params)}>
        <span className="proto-a-card-top"><span className="proto-emoji">{g.emoji}</span>{n > 0 && <span className="proto-badge">{n}</span>}</span>
        <strong>{g.name}</strong>
        {state === 'loading' ? <span className="proto-skel proto-skel-line" /> : <span className={`proto-balance ${b.tone}`}>{b.label}</span>}
        <span className="proto-a-card-bottom"><Avatars names={g.members} /><small>{g.members.length} members</small></span>
      </button>; })}
      <button className="proto-a-card proto-a-create"><Icon name="plus" /><span>New group</span></button>
    </div>
  </>;
}

// ---------- Variant B: two-column desk, task feed left and compact group list right ----------
function VariantB({ state, actions, params }: VariantProps) {
  if (state === 'no-groups') return <NoGroups />;
  const blocks = (['share', 'repayment', 'draft'] as const).map(t => ({ t, items: actions.filter(a => actionCopy(a).type === t) })).filter(x => x.items.length);
  return <div className={`proto-b ${actions.length === 0 && state !== 'loading' ? 'proto-b-single' : ''}`}>
    {state === 'loading' ? <div className="proto-skel proto-skel-block" /> : actions.length > 0 && <section className="proto-b-feed">
      {blocks.map(({ t, items }) => <div key={t} className="proto-b-block">
        <h2><Icon name={TYPE_ICON[t]} size={16} />{TYPE_LABEL[t]}<span className="count">{items.length}</span></h2>
        {items.map((a, i) => { const c = actionCopy(a); const g = group(a.groupId); return <button key={i} className="proto-b-task" onClick={() => openGroup(a.groupId, params)}>
          <span className="proto-b-group">{g.emoji} {g.name}</span>
          <strong>{c.verb}</strong>
          <span className="proto-b-detail">{c.detail}</span>
          <span className="proto-b-cta">{c.amount !== null ? money(c.amount) : 'Open'} →</span>
        </button>; })}
      </div>)}
    </section>}
    <aside className="proto-b-groups">
      <h2>Your groups</h2>
      <ul>{GROUPS.map(g => { const b = balance(g.netCents); const n = countFor(actions, g.id); return <li key={g.id}><button onClick={() => openGroup(g.id, params)}>
        <span className="proto-emoji small">{g.emoji}</span>
        <span className="proto-b-gtext"><strong>{g.name}</strong><small>{g.members.length} members</small></span>
        {n > 0 && <span className="proto-badge">{n}</span>}
        {state === 'loading' ? <span className="proto-skel proto-skel-line short" /> : <span className={`proto-balance ${b.tone}`}>{b.label}</span>}
      </button></li>; })}</ul>
      <button className="proto-b-new"><Icon name="plus" size={16} />New group</button>
    </aside>
  </div>;
}

// ---------- Variant C: horizontal action strip over full-width group rows ----------
function VariantC({ state, actions, params, rowsOnly = false }: VariantProps & { rowsOnly?: boolean }) {
  if (state === 'no-groups') return <NoGroups />;
  return <>
    {!rowsOnly && (state === 'loading' ? <div className="proto-skel proto-skel-strip" /> : actions.length > 0 && <section className="proto-c-strip" aria-label="Needs you">
      {actions.map((a, i) => { const c = actionCopy(a); const g = group(a.groupId); return <button key={i} className={`proto-c-tile proto-c-${c.type}`} onClick={() => openGroup(a.groupId, params)}>
        <span className="proto-c-tile-top"><Icon name={TYPE_ICON[c.type]} size={16} /><small>{g.emoji} {g.name}</small></span>
        <strong>{c.verb}</strong>
        <span>{c.detail}</span>
        {c.amount !== null && <b>{money(c.amount)}</b>}
      </button>; })}
    </section>)}
    <section className="proto-c-rows">
      {GROUPS.map(g => { const n = countFor(actions, g.id); const tone = balance(g.netCents).tone; return <button key={g.id} className="proto-c-row" onClick={() => openGroup(g.id, params)}>
        <span className="proto-emoji">{g.emoji}</span>
        <span className="proto-c-name"><strong>{g.name}</strong><span><Avatars names={g.members} /> {g.members.length} members</span></span>
        <span className="proto-c-right">
          {state === 'loading' ? <span className="proto-skel proto-skel-line short" /> : <span className={`proto-c-amount ${tone}`}><small>{g.netCents === 0 ? 'All square' : g.netCents < 0 ? 'You owe' : "You're owed"}</small>{g.netCents === 0 ? 'Settled' : money(g.netCents)}</span>}
          {n > 0 ? <span className="proto-c-pending">{n} to do</span> : <span className="proto-c-pending none">Nothing to do</span>}
        </span>
        <Icon name="arrow" size={18} className="proto-c-arrow" />
      </button>; })}
      <button className="proto-c-row proto-c-create"><Icon name="plus" /> New group</button>
    </section>
  </>;
}

// ---------- Variant D (owner's pick): A's inbox card over C's group rows ----------
function VariantD(props: VariantProps) {
  if (props.state === 'no-groups') return <NoGroups />;
  const { state, actions, params } = props;
  return <>
    {state === 'loading' ? <div className="proto-skel proto-skel-block" /> : actions.length > 0 && <section className="proto-a-inbox">
      <h2>Needs you</h2>
      <ul>{actions.map((a, i) => { const c = actionCopy(a); const g = group(a.groupId); return <li key={i}><button onClick={() => openGroup(a.groupId, params)}>
        <span className={`proto-type proto-type-${c.type}`}><Icon name={TYPE_ICON[c.type]} size={18} /></span>
        <span className="proto-a-text"><strong>{c.verb}</strong><small>{g.emoji} {g.name} · {c.detail}</small></span>
        <span className="proto-a-amount">{c.amount !== null && money(c.amount)} <span aria-hidden="true">→</span></span>
      </button></li>; })}</ul>
    </section>}
    <h2 className="proto-section-title">Your groups</h2>
    <VariantC {...props} rowsOnly />
  </>;
}

// ---------- Group page stub: only the heading dropdown is decided here ----------
function GroupStub({ id, actions, params }: { id: string; actions: Action[]; params: URLSearchParams }) {
  const g = group(id);
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!menu.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  const b = balance(g.netCents);
  return <>
    <div className="proto-group-head">
      <div className="eyebrow">YOUR SHOPPING CIRCLE</div>
      <div className="proto-switch" ref={menu}>
        <button className="proto-switch-button" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(o => !o)}>
          <span className="proto-emoji small">{g.emoji}</span><h1>{g.name}</h1><Icon name="down" size={22} />
        </button>
        {open && <ul className="proto-switch-menu" role="listbox" aria-label="Switch group">
          {GROUPS.map(o => { const n = countFor(actions, o.id); return <li key={o.id} role="option" aria-selected={o.id === id}>
            <button onClick={() => { setOpen(false); openGroup(o.id, params); }}>
              <span className="proto-emoji small">{o.emoji}</span><span className="proto-switch-name">{o.name}</span>{n > 0 && <span className="proto-badge">{n}</span>}{o.id === id && <Icon name="check" size={16} />}
            </button>
          </li>; })}
        </ul>}
      </div>
      <p className={`proto-balance ${b.tone}`}>{b.label}</p>
    </div>
    <div className="proto-group-placeholder">
      <p><strong>Group page content goes here.</strong></p>
      <p>Bills, next transfer, member balances and repayments stay as they are today. They are out of scope for #82 and will get their own grilling session. This stub only shows the heading dropdown that replaces the left group rail.</p>
      <Button variant="secondary" onClick={() => go('/prototype/home', params)}>← Back to Home</Button>
    </div>
  </>;
}

const VARIANTS = [
  { key: 'A', name: 'Stacked inbox + card grid' },
  { key: 'B', name: 'Two-column desk' },
  { key: 'C', name: 'Action strip + group rows' },
  { key: 'D', name: 'A inbox + C rows (picked)' },
];
const RENDER = { A: VariantA, B: VariantB, C: VariantC, D: VariantD } as const;

export default function HomePrototype() {
  const { groupId, params } = parse(useHash());
  const variant = (VARIANTS.some(v => v.key === params.get('variant')) ? params.get('variant') : 'A') as keyof typeof RENDER;
  const state = ((DATA_STATES as string[]).includes(params.get('data') ?? '') ? params.get('data') : 'busy') as DataState;
  const actions = state === 'busy' ? ACTIONS : [];
  const path = groupId ? `/prototype/home/group/${groupId}` : '/prototype/home';
  function set(key: string, value: string) {
    const next = new URLSearchParams(params); next.set(key, value);
    window.history.replaceState(null, '', `#${path}?${next}`);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  }
  const Variant = RENDER[variant];
  return <div className="play proto-home">
    <TopBar params={params} />
    <main className="proto-main">
      {groupId ? <GroupStub id={groupId} actions={actions} params={params} /> : <>
        <Heading state={state} count={actions.length} />
        <Variant state={state} actions={actions} params={params} />
      </>}
    </main>
    <PrototypeSwitcher variants={VARIANTS} current={variant} onChange={v => set('variant', v)} extra={
      <select value={state} onChange={e => set('data', e.target.value)} aria-label="Mock data state" style={{ background: '#333', color: '#fff', border: 0, borderRadius: 999, padding: '5px 8px', font: 'inherit' }}>
        {DATA_STATES.map(s => <option key={s} value={s}>data: {s}</option>)}
      </select>
    } />
  </div>;
}

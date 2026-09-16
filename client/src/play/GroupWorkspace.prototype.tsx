// THROWAWAY: three group-workspace hierarchies on the existing route, ?variant=A|B|C.
import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Plus, Users, ArrowUpRight, Check, ShoppingBasket } from 'lucide-react';
import type { Bill, GroupLedger, Summary } from './bill-api';
import { money } from './bill-api';
import type { GroupDetail } from './group-api';
import Dialog from './Dialog';
import './group-workspace.prototype.css';

type Data = { group: GroupDetail; bills: Bill[]; ledger: GroupLedger; summary: Summary };
const names = ['Balance first', 'Activity first', 'Ledger'];
export default function GroupWorkspacePrototype({ data }: { data: Data }) {
  const [variant, setVariant] = useState(() => Math.max(0, ['A', 'B', 'C'].indexOf(new URLSearchParams(location.search).get('variant') ?? 'A')));
  const [action, setAction] = useState('');
  function change(direction: number) {
    setVariant(current => {
      const next = (current + direction + 3) % 3;
      const url = new URL(location.href); url.searchParams.set('variant', 'ABC'[next]); history.replaceState(null, '', url);
      return next;
    });
    setAction('');
  }
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement).closest('input, textarea, select, [contenteditable], dialog')) return;
      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); change(event.key === 'ArrowRight' ? 1 : -1); }
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, []);
  useEffect(() => { console.info('Prototype state', { variant: 'ABC'[variant], group: data.group, bills: data.bills, ledger: data.ledger, summary: data.summary }); }, [variant, data]);
  const props = { data, act: setAction };
  return <div className={`workspace-prototype direction-${variant}`}>
    <div className="prototype-note">DESIGN STUDY / {'ABC'[variant]} <span>Sample data · local interactions only</span></div>
    {variant === 0 ? <VariantA {...props} /> : variant === 1 ? <VariantB {...props} /> : <VariantC {...props} />}
    {import.meta.env.DEV && <nav className="prototype-switcher" aria-label="Design variations">
      <button onClick={() => change(-1)} aria-label="Previous design"><ArrowLeft size={18} /></button>
      <span><small>EXPLORE 3 DIRECTIONS</small><b>{'ABC'[variant]} / {names[variant]}</b></span>
      <button onClick={() => change(1)} aria-label="Next design"><ArrowRight size={18} /></button>
    </nav>}
    {action && <Dialog title={action} kicker="PROTOTYPE · NO CHANGES SAVED" close={() => setAction('')}>
      {action === 'Members & invites' ? <><p>Your shopping circle</p>{data.group.members.map(m => <p key={m.id}>{m.displayName} {m.isCurrentUser ? '· You' : ''}</p>)}<button className="proto-secondary" onClick={() => setAction('Invitation preview')}>Preview invitation</button></> : action === 'New bill' ? <form onSubmit={e => { e.preventDefault(); setAction('Bill draft preview'); }} className="proto-form"><label>What did you buy?<input placeholder="Weekend groceries" required /></label><label>Total · CAD<input placeholder="0.00" inputMode="decimal" required /></label><button className="proto-primary">Preview draft</button></form> : <><p>This opens the {action.toLowerCase()} flow in the finished app.</p><p>Here, you’re comparing placement and hierarchy. Nothing is saved or transferred.</p></>}
    </Dialog>}
  </div>;
}
type Props = { data: Data; act: (action: string) => void };
function Actions({ act }: Pick<Props, 'act'>) { return <div className="proto-actions"><button className="proto-secondary" onClick={() => act('Members & invites')}><Users size={16}/> Members & invites</button><button className="proto-primary" onClick={() => act('New bill')}><Plus size={17}/> New bill</button></div>; }
export function VariantA({ data, act }: Props) {
  return <><header className="proto-title"><div><p>YOUR SHOPPING CIRCLE</p><h2>{data.group.name}</h2><span>{data.group.memberCount} friends · CAD</span></div><Actions act={act}/></header>
    <div className="proto-overview"><section className="proto-total"><span>You are owed</span><strong>{money(data.summary.netCents)}</strong><p>Across your completed purchases.</p><div className="proto-faces">{data.group.members.map(m => <span key={m.id} title={m.displayName}>{m.displayName[0]}</span>)}<small>All in it together.</small></div></section><section className="proto-next"><span className="proto-eyebrow">NEXT TRANSFER</span><h3>One step closer<br/>to even.</h3><p>Bob → You <strong>{money(data.summary.netCents)}</strong></p><span className="proto-help">Suggested transfer, made outside ShareTally.</span><button className="proto-secondary" onClick={() => act('Repayment history')}>View repayments <ArrowUpRight size={16}/></button></section></div>
    <div className="proto-section-title"><h3>Shared purchases</h3><span>{data.bills.length} bills</span></div><PurchaseList data={data} act={act}/><div className="proto-footnote"><Check size={15}/> Completed purchases stay in your history.</div></>;
}
export function VariantB({ data, act }: Props) {
  return <><header className="proto-title"><div><p>THE GROUP JOURNAL</p><h2>{data.group.name}</h2></div><button className="proto-secondary" onClick={() => act('Members & invites')}><Users size={16}/> {data.group.memberCount} friends</button></header>
    <div className="proto-journal"><section><div className="proto-journal-heading"><h3>What’s happening</h3><button className="proto-primary" onClick={() => act('New bill')}><Plus size={16}/> Add a purchase</button></div><p className="proto-date">THIS WEEK · SEPTEMBER 2026</p>{data.bills.map((bill,i) => <button key={bill.id} className="proto-event" onClick={() => act(bill.title)}><span className={`proto-event-dot ${i ? '' : 'pending'}`}><ShoppingBasket size={18}/></span><div><small>{bill.purchaseDate} · {i ? 'Everyone confirmed' : 'Waiting for shares'}</small><h4>{bill.title}</h4><p>{i ? 'Agreed, recorded, and part of your balance.' : 'Two friends still need to confirm their share.'}</p></div><strong>{money(bill.totalCents)}</strong></button>)}</section>
    <aside className="proto-journal-aside"><span className="proto-eyebrow">WHERE YOU STAND</span><h3>{money(data.summary.netCents)}</h3><p>owed to you</p><hr/>{data.ledger.members.map(m => <div className="proto-member" key={m.userId}><span>{m.displayName}</span><b>{m.netCents > 0 ? '+' : ''}{money(m.netCents)}</b></div>)}<button className="proto-secondary" onClick={() => act('Repayment history')}>Repayment details <ArrowUpRight size={15}/></button><p className="proto-help">1 incomplete bill excluded.</p></aside></div></>;
}
export function VariantC({ data, act }: Props) {
  return <><header className="proto-title"><div><p>GROUP LEDGER / CAD</p><h2>{data.group.name}</h2></div><Actions act={act}/></header><div className="proto-stats"><div><small>NET RECEIVABLE</small><strong>{money(data.summary.netCents)}</strong></div><div><small>MEMBERS</small><strong>03</strong></div><div><small>OPEN BILLS</small><strong>01</strong></div></div><div className="proto-ledger-grid"><section><div className="proto-section-title"><h3>Purchase ledger</h3><span>All dates</span></div><div className="proto-table-wrap"><table><thead><tr><th>Purchase</th><th>Status</th><th>Amount</th></tr></thead><tbody>{data.bills.map(b => <tr key={b.id}><td><button onClick={() => act(b.title)}>{b.title}</button><small>{b.purchaseDate}</small></td><td><span className={`proto-status ${b.completedAt ? 'done' : ''}`}>{b.completedAt ? 'Complete' : 'In progress'}</span></td><td>{money(b.totalCents)}</td></tr>)}</tbody></table></div></section><section className="proto-netting"><h3>Net balances</h3><p className="proto-help">+ Receivable · − Payable</p>{data.ledger.members.map(m => <div className="proto-member" key={m.userId}><span>{m.displayName}</span><b>{m.netCents > 0 ? '+' : ''}{money(m.netCents)}</b></div>)}<div className="proto-transfer"><small>SUGGESTED TRANSFER</small><p>Bob → Alice <b>{money(data.summary.netCents)}</b></p><button onClick={() => act('Record repayment')}>Record a transfer <ArrowUpRight size={15}/></button></div></section></div></>;
}
function PurchaseList({ data, act }: Props) { return <div className="proto-purchases">{data.bills.map(b => <button key={b.id} onClick={() => act(b.title)}><span className="proto-purchase-icon"><ShoppingBasket size={20}/></span><span><b>{b.title}</b><small>{b.purchaseDate} · {b.completedAt ? 'Complete' : '2 shares to confirm'}</small></span><strong>{money(b.totalCents)}</strong><ArrowUpRight size={17}/></button>)}</div>; }

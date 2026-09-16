// Throwaway: compare three notification placements using in-memory bill scenarios.
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AlertTriangle, CheckCircle2, Info, CircleAlert, ArrowRight, ArrowLeft, X, Users, LayoutGrid, Settings, Bell } from 'lucide-react';
import './notification-prototype.css';

const scenarios = {
  warning: { label: '需要调整', icon: AlertTriangle, tag: 'Action needed', title: 'Shares are $1.00 over the total', body: 'Everyone confirmed, but the bill cannot complete. Check your share and correct it if needed.', detail: 'Shares must be within $0.05 of the bill total. Changing a saved amount requires renewed confirmations. The initiator’s new amount is confirmed when saved.', action: 'Review my share' },
  success: { label: '操作成功', icon: CheckCircle2, tag: 'Saved', title: 'Your share is confirmed', body: 'Your $20.00 share was saved. We’re waiting for Wang to confirm.', detail: 'You can still correct your share while this bill is in progress.', action: 'View everyone’s shares' },
  error: { label: '保存失败', icon: CircleAlert, tag: 'Couldn’t save', title: 'Your share wasn’t saved', body: 'The connection was interrupted. Your $20.00 draft is still here.', detail: 'Retry to send the same amount. No new confirmation has been recorded in this demo.', action: 'Retry saving' },
  info: { label: '需要重新确认', icon: Info, tag: 'Bill updated', title: 'Review your share again', body: 'Wang changed their share from $2.00 to $1.00. Your $21.00 amount is retained.', detail: 'Previous confirmations were cleared. Review the current bill before confirming your share again.', action: 'Review and confirm' },
};
type Kind = keyof typeof scenarios;
const variants = ['A', 'B', 'C'] as const;
type Variant = typeof variants[number];
const names = { A: '页内横幅', B: '右侧待办卡', C: '浮动通知卡' };
export default function Prototype() {
  const initial = new URLSearchParams(location.search).get('variant');
  const [variant, setVariant] = useState<Variant>(variants.includes(initial as Variant) ? initial as Variant : 'A');
  const [kind, setKind] = useState<Kind>('warning');
  const [details, setDetails] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [amount, setAmount] = useState('21.00');
  const [result, setResult] = useState('');
  const data = scenarios[kind];
  function changeVariant(next: Variant) {
    setVariant(next); setDismissed(false);
    const url = new URL(location.href); url.searchParams.set('variant', next); history.replaceState(null, '', url);
  }
  useEffect(() => {
    function key(event: KeyboardEvent) {
      if ((event.target as HTMLElement).closest('input,textarea,select,[contenteditable]')) return;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        changeVariant(variants[(variants.indexOf(variant) + (event.key === 'ArrowRight' ? 1 : 2)) % 3]);
      }
    }
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, [variant]);
  function act() {
    if (kind === 'error') { setKind('success'); setResult('Prototype · retry succeeded'); return; }
    document.getElementById(kind === 'success' ? 'people' : 'share-input')?.focus();
    document.getElementById(kind === 'success' ? 'people' : 'share-input')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setResult(kind === 'warning' ? 'Check your actual share before changing it.' : 'Review the current amounts before confirming.');
  }
  const notice = dismissed ? <button className="restore" onClick={() => setDismissed(false)}><Bell size={17}/> Show notification</button> :
    <section className={`notification ${kind}`} aria-live="polite">
      <div className="notice-symbol"><data.icon size={22}/></div>
      <div className="notice-content"><span className="notice-tag">{data.tag}</span><h2>{data.title}</h2><p>{data.body}</p>
        {details && <p className="detail">{data.detail}</p>}
        <div className="notice-actions"><button className="notice-primary" onClick={act}>{data.action}<ArrowRight size={15}/></button><button className="text-button" onClick={() => setDetails(!details)}>{details ? 'Less detail' : 'Why this matters'}</button></div>
      </div>
      {kind === 'success' && <button className="close" aria-label="Dismiss notification" onClick={() => setDismissed(true)}><X size={18}/></button>}
    </section>;
  return <div className={`prototype variant-${variant}`}>
    <aside className="sidebar"><div className="logo">▥ sharetally<span>.</span></div><small>YOUR LITTLE CORNER</small><nav><div className="selected"><LayoutGrid size={19}/>Overview</div><div><Users size={19}/>My groups</div><div><Settings size={19}/>Account</div></nav><div className="sidebar-bottom">More friendship.<br/>Less “you owe me.”</div><footer>Simian <small>Personal account</small></footer></aside>
    <main><div className="prototype-tools"><span>DESIGN PROTOTYPE · 示例数据</span><label>通知场景 <select value={kind} onChange={e => { setKind(e.target.value as Kind); setDismissed(false); setDetails(false); setResult(''); setAmount(e.target.value === 'success' || e.target.value === 'error' ? '20.00' : '21.00'); }}>{Object.entries(scenarios).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}</select></label></div>
      <header><span className="breadcrumb">Costco friends / Bill</span><h1>test222</h1><p>2026-09-16 · Paid by wangsimian2020 · CAD</p></header>
      <div className="page-grid"><div className="bill-content">
        {variant === 'A' && notice}
        <div className="summary-grid"><section className="total-card"><span className="status">{kind === 'warning' ? 'NEEDS ATTENTION' : 'IN PROGRESS'}</span><h2>{kind === 'warning' ? 'Over the total' : 'Exact match'}</h2><strong className="big">{kind === 'warning' ? '$1.00' : '$0.00'}</strong><p>{kind === 'warning' ? '2/2 confirmed · Amounts need correction' : '1/2 confirmed · Waiting for confirmation'}</p><dl><div><dt>Bill total</dt><dd>$22.00</dd></div><div><dt>Submitted shares</dt><dd>{kind === 'warning' ? '$23.00' : '$22.00'}</dd></div></dl></section>
        <section className="people card" id="people" tabIndex={-1}><h2>Everyone’s share</h2><div className="person"><span className="avatar">W</span><div><b>wangsimian2020</b><small>Initiator · {kind === 'warning' || kind === 'error' ? 'Confirmed' : 'Awaiting confirmation'}</small></div><b>{kind === 'info' ? '$1.00' : '$2.00'}</b></div><div className="person"><span className="avatar simian">S</span><div><b>Simian Wang · You</b><small>{kind === 'info' || kind === 'error' ? 'Awaiting confirmation' : 'Confirmed'}</small></div><b>{kind === 'success' || kind === 'error' ? '$20.00' : '$21.00'}</b></div></section></div>
        <section className="notes card"><h2>Purchase notes</h2><p>Costco shopping with friends.</p></section>
        <section className="share card"><small>YOUR SHARE</small><h2>{kind === 'warning' ? 'Your share is confirmed' : 'Review your share'}</h2><label htmlFor="share-input">My share · CAD</label><input id="share-input" value={amount} onChange={e => setAmount(e.target.value)}/><p>Changing your amount clears previous confirmations. Review and confirm again after saving.</p><button className="save" onClick={() => setResult('Prototype only · no bill data was changed.')}>Save changed amount</button>{result && <p role="status" className="result">{result}</p>}</section>
      </div>{variant === 'B' && <aside className="notice-rail"><div className="rail-heading"><Bell size={16}/> Bill activity <span>1</span></div>{notice}</aside>}</div>
      {variant === 'C' && <aside className="toast-area">{notice}</aside>}
      <div className="design-note">{variant === 'A' ? 'A · 页面级问题直接出现在账单上方，持续可见。推荐用于需要处理的状态。' : variant === 'B' ? 'B · 通知集中在侧栏，可扩展为多项待办，但会压缩账单内容。手机上移至页面顶部。' : 'C · 浮动卡不改变页面布局，适合短反馈；长通知会遮挡内容，不建议单独承载阻塞问题。'}</div>
    </main>
    {import.meta.env.DEV && <div className="switcher"><button aria-label="Previous design" onClick={() => changeVariant(variants[(variants.indexOf(variant) + 2) % 3])}><ArrowLeft size={18}/></button><div><small>NOTIFICATION DESIGN</small><strong>{variant} · {names[variant]}</strong></div><button aria-label="Next design" onClick={() => changeVariant(variants[(variants.indexOf(variant) + 1) % 3])}><ArrowRight size={18}/></button></div>}
  </div>;
}
createRoot(document.getElementById('root')!).render(<Prototype/>);

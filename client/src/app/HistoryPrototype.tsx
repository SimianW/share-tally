// Throwaway: three ways to reveal canceled bills on /#/group-bills/:id,
// switchable via ?variant=A|B|C. The rest of GroupPage and its loaded data stay.
import { useState, type ReactNode } from 'react';
import { ChevronDown, Archive, Eye, EyeOff } from 'lucide-react';
import type { Bill } from '@share-tally/domain/contracts/bills';
import { PrototypeSwitcher } from '../shared/ui/PrototypeSwitcher';
import { SegmentedControl } from '../shared/ui/SegmentedControl';
import { Button } from '../shared/ui/Button';
import './history-prototype.css';

const variants = [
  { key: 'A', name: 'Header button' },
  { key: 'B', name: 'Collapsed archive' },
  { key: 'C', name: 'History tabs' },
] as const;

export function HistoryPrototype({ bills, renderBill }: { bills: Bill[]; renderBill: (bill: Bill) => ReactNode }) {
  const requested = new URLSearchParams(window.location.search).get('variant');
  const [variant, setVariant] = useState(variants.find(v => v.key === requested)?.key ?? 'A');
  const [showCanceled, setShowCanceled] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const completed = bills.filter(bill => !bill.canceledAt);
  const canceled = bills.filter(bill => !!bill.canceledAt);
  const visible = variant === 'C' ? showCanceled ? canceled : completed
    : variant === 'A' && showCanceled ? bills : completed;
  const rows = showAll ? visible : visible.slice(0, 5);
  const choose = (key: string) => {
    const next = variants.find(v => v.key === key)!.key;
    const url = new URL(window.location.href);
    url.searchParams.set('variant', next);
    window.history.replaceState(null, '', url);
    setVariant(next);
    setShowCanceled(false);
    setShowAll(false);
  };
  const changeCanceled = (value: boolean) => { setShowCanceled(value); setShowAll(false); };
  const list = <div className="group-history-list" id="prototype-history-rows">
    {rows.length ? rows.map(renderBill) : <p className="group-empty">{showCanceled ? 'No canceled bills.' : 'No completed bills yet.'}</p>}
  </div>;
  const more = visible.length > 5 && <Button className="small group-show-history" variant="secondary" onClick={() => setShowAll(value => !value)}>
    {showAll ? 'Show fewer' : `Show all ${visible.length}`}
  </Button>;

  return <section className={`history-prototype history-prototype-${variant}`} aria-label="History" id="history-prototype">
    {variant === 'A' && <>
      <div className="history-prototype-heading">
        <h2 className="group-section-heading">History <span className="count">{visible.length}</span></h2>
        {canceled.length > 0 && <button type="button" className="button secondary small" aria-expanded={showCanceled} aria-controls="prototype-history-rows" onClick={() => changeCanceled(!showCanceled)}>
          {showCanceled ? <EyeOff size={15} /> : <Eye size={15} />}
          {showCanceled ? 'Hide canceled' : `Show canceled · ${canceled.length}`}
        </button>}
      </div>
      {list}{more}
    </>}
    {variant === 'B' && <>
      <h2 className="group-section-heading">History <span className="count">{completed.length}</span></h2>
      {list}{more}
      {canceled.length > 0 && <div className="history-prototype-archive">
        <button type="button" aria-expanded={showCanceled} aria-controls="prototype-canceled-rows" onClick={() => changeCanceled(!showCanceled)}>
          <Archive size={18} /><span><strong>Canceled bills <span className="count">{canceled.length}</span></strong><small>Kept for reference</small></span>
          <ChevronDown size={18} className={showCanceled ? 'history-prototype-chevron-open' : ''} />
        </button>
        {showCanceled && <div className="group-history-list" id="prototype-canceled-rows">{canceled.map(renderBill)}</div>}
      </div>}
    </>}
    {variant === 'C' && <>
      <div className="history-prototype-heading">
        <h2 className="group-section-heading">History</h2>
        <SegmentedControl label="History status" value={showCanceled ? 'canceled' : 'completed'} onChange={value => changeCanceled(value === 'canceled')}
          options={[
            { value: 'completed', content: `Completed · ${completed.length}` },
            { value: 'canceled', content: `Canceled · ${canceled.length}` },
          ]} />
      </div>
      {list}{more}
    </>}
    <PrototypeSwitcher variants={variants} current={variant} onChange={choose}
      state={`${completed.length} completed · ${canceled.length} canceled · ${rows.length + (variant === 'B' && showCanceled ? canceled.length : 0)} shown · ${showCanceled ? 'canceled visible' : 'canceled hidden'}`} />
  </section>;
}

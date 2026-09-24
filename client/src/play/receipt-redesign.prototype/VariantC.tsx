import { useState } from 'react'
import { Camera, ChevronDown, ChevronUp, Pencil } from 'lucide-react'
import ReceiptImage from './ReceiptImage'
import { deriveCosts, money } from './mock-data'
import type { DerivedItem } from './mock-data'
import { FlowHeader, ItemEditor, Placeholder, Reconciliation, SummaryPanel, needsCheck } from './VariantA'
import type { ReviewProps } from './VariantA'

export default function VariantC({ items, summary, updateItem, setSummary }: ReviewProps) {
  const [selected, setSelected] = useState<string | null>(null)
  const [photoOpen, setPhotoOpen] = useState(() => window.matchMedia('(min-width: 900px)').matches)
  const [summaryOpen, setSummaryOpen] = useState(false)
  const [step, setStep] = useState('Items')
  const derived = deriveCosts(items, summary)
  const groups = [{ name: 'Needs check', items: derived.filter(needsCheck) }, { name: 'Looks good', items: derived.filter(item => !needsCheck(item)) }]
  const jump = (offset: number) => { const index = derived.findIndex(item => item.id === selected); setSelected(derived[(index + offset + derived.length) % derived.length].id) }
  const mirrorRow = (item: DerivedItem) => <div className={'mirror-row ' + (selected === item.id ? 'expanded' : '')} key={item.id}>
    <button className="mirror-row-button" onClick={() => setSelected(selected === item.id ? null : item.id)}><span className="mirror-row-details"><code>{item.originalText}</code><strong>{item.name} {item.quantity !== 1 && <span>×{item.quantity}</span>}</strong><small>{needsCheck(item) ? (item.printedCents === null ? 'Missing price' : '⚠ Needs check') : !item.taxable ? 'No tax' : 'Tap to edit'}</small></span><span className="mirror-price"><b>{item.printedCents === null && item.manualFinalCents == null ? '—' : money(item.finalCents)}</b><Pencil size={14} /></span></button>
    {selected === item.id && <ItemEditor key={item.id} item={item} receiptItems={items} updateItem={updateItem} compact onPrev={() => jump(-1)} onNext={() => jump(1)} close={() => setSelected(null)} />}
  </div>
  return <><FlowHeader step={step} onStep={setStep} />{step !== 'Items' ? <Placeholder step={step} onBack={() => setStep('Items')} /> : <>
    <div className="variant-layout variant-c"><main className="mirror-main"><div className="variant-heading"><div className="eyebrow">OPTION C / RECEIPT MIRROR</div><h2>Check the receipt, line by line</h2><p>The printed line and the cleaned-up item, together.</p></div>
      <div className="mirror-paper"><div className="mirror-paper-top"><strong>COSTCO <span>WHOLESALE</span></strong><span>ITEM REVIEW · 25 LINES</span></div>
        {groups.map(group => <section className="mirror-group" key={group.name}><h3>{group.name} <span>({group.items.length})</span></h3>{group.items.length ? group.items.map(mirrorRow) : <p className="empty-message">Nothing to check here.</p>}<div className="group-total"><span>{group.name} subtotal</span><strong>{money(group.items.reduce((sum, item) => sum + item.finalCents, 0))}</strong></div></section>)}
      </div></main><aside className={'mirror-photo ' + (photoOpen ? 'open' : '')}><button className="photo-toggle" onClick={() => setPhotoOpen(open => !open)}><Camera size={17} /> Receipt photo {photoOpen ? <ChevronUp size={17} /> : <ChevronDown size={17} />}</button><div className="mirror-photo-content"><ReceiptImage items={items} highlight={selected ?? undefined} summary={summary} mode="photo" /></div></aside></div>
    <Reconciliation items={derived} summary={summary} onSummary={() => setSummaryOpen(true)} onNext={() => setStep('People')} />
    {summaryOpen && <SummaryPanel summary={summary} setSummary={setSummary} close={() => setSummaryOpen(false)} />}
  </>}</>
}

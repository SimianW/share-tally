import { useState } from 'react'
import { Check, ChevronLeft, ChevronRight, List, Pencil } from 'lucide-react'
import ReceiptImage from './ReceiptImage'
import { deriveCosts, money } from './mock-data'
import { FlowHeader, ItemEditor, ItemRow, Placeholder, Reconciliation, SummaryPanel, needsCheck } from './VariantA'
import type { ReviewProps } from './VariantA'

export default function VariantB({ items, summary, updateItem, setSummary }: ReviewProps) {
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [showList, setShowList] = useState(false)
  const [editing, setEditing] = useState(false)
  const [summaryOpen, setSummaryOpen] = useState(false)
  const [step, setStep] = useState('Items')
  const derived = deriveCosts(items, summary)
  const queue = [...derived.filter(needsCheck), ...derived.filter(item => !needsCheck(item))]
  const current = queue.find(item => item.id === currentId) ?? queue[0]
  const index = queue.findIndex(item => item.id === current.id)
  const advance = (offset = 1) => { setCurrentId(queue[(index + offset + queue.length) % queue.length].id); setEditing(false) }
  const confirm = () => { updateItem(current.id, { confirmed: true }); advance() }
  return <><FlowHeader step={step} onStep={setStep} />{step !== 'Items' ? <Placeholder step={step} onBack={() => setStep('Items')} /> : <>
    <div className="variant-layout variant-b"><aside className="queue-photo"><div className="eyebrow">OPTION B / REVIEW QUEUE</div><ReceiptImage items={items} highlight={current.id} summary={summary} mode="photo" /></aside>
      <main className="queue-main"><div className="queue-topline"><span>ITEM {index + 1} OF {queue.length} · {queue.filter(needsCheck).length} NEED CHECK</span><button className="text-link" onClick={() => setShowList(value => !value)}><List size={16} /> {showList ? 'Hide list' : 'Show all as list'}</button></div>
        <div className="queue-track"><span style={{ width: `${(index + 1) / queue.length * 100}%` }} /></div>
        {showList ? <div className="list-card queue-list">{queue.map(item => <ItemRow item={item} key={item.id} onClick={() => { setCurrentId(item.id); setShowList(false); setEditing(false) }} />)}</div> : <div className="focus-card"><div className="focus-card-head"><span className="eyebrow">{needsCheck(current) ? '⚠ TAKE A CLOSER LOOK' : 'READY TO REVIEW'}</span><strong>{current.printedCents === null ? 'Missing price' : money(current.finalCents)}</strong></div><h2>{current.name}</h2><p className="focus-source">{current.originalText}</p>
          {editing ? <ItemEditor key={current.id} item={current} receiptItems={items} updateItem={updateItem} compact onPrev={() => advance(-1)} onNext={() => advance(1)} close={() => setEditing(false)} /> : <><div className="focus-facts"><span>Quantity <b>×{current.quantity}</b></span><span>Printed <b>{current.printedCents === null ? '—' : money(current.printedCents)}</b></span><span>Savings <b>−{money(current.discountCents)}</b></span><span>Tax share <b>{money(current.taxShareCents)}</b></span></div><div className="focus-actions"><button className="primary-button" onClick={confirm}><Check size={18} /> Looks right</button><button className="secondary-button" onClick={() => setEditing(true)}><Pencil size={17} /> Fix</button></div></>}
        </div>}
        <div className="queue-navigation"><button onClick={() => advance(-1)}><ChevronLeft size={17} /> Previous</button><span>{index + 1} of {queue.length}</span><button onClick={() => advance()} >Next <ChevronRight size={17} /></button></div>
      </main></div>
    <Reconciliation items={derived} summary={summary} onSummary={() => setSummaryOpen(true)} onNext={() => setStep('People')} />
    {summaryOpen && <SummaryPanel summary={summary} setSummary={setSummary} close={() => setSummaryOpen(false)} />}
  </>}</>
}

/* eslint-disable react-refresh/only-export-components -- Throwaway prototype shares controls within its variants. */
import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, ReceiptText, X } from 'lucide-react'
import ReceiptImage from './ReceiptImage'
import { deriveCosts, money } from './mock-data'
import type { Item, DerivedItem, ReceiptSummary } from './mock-data'

export type ReviewProps = {
  items: Item[]
  summary: ReceiptSummary
  updateItem: (id: string, patch: Partial<Item>) => void
  setSummary: (summary: ReceiptSummary) => void
}
export const needsCheck = (item: Item) => item.printedCents === null || (!item.confirmed && (item.confidence.name < .8 || item.confidence.price < .8))
export const parsePrice = (value: string) => value.trim() === '' ? null : Math.round(Number(value) * 100) || 0
export const priceInput = (value: number | null) => value === null ? '' : (value / 100).toFixed(2)

export function FlowHeader({ step, onStep }: { step: string; onStep: (step: string) => void }) {
  return <header className="flow-header">
    <div className="flow-heading"><button className="icon-button" aria-label="Back" onClick={() => onStep('Receipt')}><ArrowLeft size={20} /></button><div><div className="eyebrow">SHARETALLY / NEW BILL</div><h1>New bill <span>·</span> Costco friends</h1></div></div>
    <div className="steps" aria-label="Bill progress">{['Receipt', 'Items', 'People'].map((name, index) => <button key={name} onClick={() => onStep(name)} className={step === name ? 'active' : ''}><span className="step-number">{index + 1}</span>{name}{index < 2 && <ArrowRight className="step-arrow" size={14} />}</button>)}</div>
  </header>
}
export function Placeholder({ step, onBack }: { step: string; onBack: () => void }) {
  return <div className="placeholder-panel"><CircleHelp size={30} /><h2>{step} step</h2><p>This prototype focuses on reviewing receipt items. The {step.toLowerCase()} step is only a placeholder.</p><button className="primary-button" onClick={onBack}>Back to items</button></div>
}
export function ItemRow({ item, onClick, children, current = false }: { item: DerivedItem; onClick: () => void; children?: React.ReactNode; current?: boolean }) {
  return <button className={'item-row' + (current ? ' current' : '')} data-item-id={item.id} onClick={onClick}>
    <span className="item-row-main"><strong>{item.name || 'Unnamed item'} {item.quantity !== 1 && <span className="quantity">×{item.quantity}</span>}</strong><span className="row-badges">{needsCheck(item) && <span className="flag">{item.printedCents === null ? 'Missing price' : '⚠ Needs check'}</span>}{!item.taxable && <span className="quiet-badge">No tax</span>}{children}</span></span>
    <span className="item-row-price">{item.printedCents === null && item.manualFinalCents == null ? '—' : money(item.finalCents)}<ChevronRight size={16} /></span>
  </button>
}
function PriceField({ label, cents, onChange, placeholder }: { label: string; cents: number | null; onChange: (next: number | null) => void; placeholder?: string }) {
  const [draft, setDraft] = useState(priceInput(cents))
  return <label className="form-field"><span>{label}</span><div className="money-input"><span>$</span><input type="number" min="0" step="0.01" value={draft} placeholder={placeholder ?? '0.00'} onChange={event => { setDraft(event.target.value); onChange(parsePrice(event.target.value)) }} onBlur={() => setDraft(priceInput(cents))} /></div></label>
}
function SummaryAmount({ label, cents, onChange }: { label: string; cents: number; onChange: (value: number) => void }) {
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => { if (input.current && document.activeElement !== input.current) input.current.value = priceInput(cents) }, [cents])
  return <div className="money-input"><span>$</span><input ref={input} aria-label={label} type="number" step="0.01" defaultValue={priceInput(cents)} onChange={event => onChange(parsePrice(event.target.value) ?? 0)} onBlur={event => { event.currentTarget.value = priceInput(cents) }} /></div>
}
export function ItemEditor({ item, receiptItems, updateItem, onPrev, onNext, close, compact = false }: { item: DerivedItem; receiptItems?: Item[]; updateItem: ReviewProps['updateItem']; onPrev: () => void; onNext: () => void; close?: () => void; compact?: boolean }) {
  const [advanced, setAdvanced] = useState(item.manualFinalCents != null)
  const edit = (patch: Partial<Item>) => updateItem(item.id, { ...patch, confirmed: true })
  return <div className={'item-editor ' + (compact ? 'inline-editor' : '')}>
    <div className="editor-heading"><div><div className="eyebrow">LINE {item.lineIndex + 1} · ITEM DETAILS</div><h2>Edit item</h2></div>{close && <button className="icon-button" aria-label="Close editor" onClick={close}><X size={20} /></button>}</div>
    {!compact && <div className="editor-photo"><ReceiptImage items={receiptItems ?? [item]} highlight={item.id} mode="crop" /></div>}
    <div className="original-text"><span>ON THE RECEIPT</span><code>{item.originalText}</code></div>
    <div className="editor-fields"><label className="form-field full"><span>Item name</span><input value={item.name} onChange={event => edit({ name: event.target.value })} /></label>
      <label className="form-field"><span>Quantity</span><input type="number" min="1" step="1" value={item.quantity} onChange={event => edit({ quantity: Math.max(1, Number(event.target.value) || 1) })} /></label>
      <PriceField label="Printed price" cents={item.printedCents} placeholder="Missing" onChange={value => edit({ printedCents: value })} />
      <PriceField label="Instant savings" cents={item.discountCents} onChange={value => edit({ discountCents: value ?? 0 })} />
      <label className="toggle-field"><span>Taxable item</span><input type="checkbox" checked={item.taxable} onChange={event => edit({ taxable: event.target.checked })} /><span className="toggle-rail" /></label>
    </div>
    <div className="computed-cost"><span>{item.manualFinalCents != null ? 'Set manually' : `Tax share ${money(item.taxShareCents)} · Final`}</span><strong>{item.printedCents === null && item.manualFinalCents == null ? 'Missing price' : money(item.finalCents)}</strong></div>
    <button className="text-link" onClick={() => setAdvanced(value => !value)}>{advanced ? 'Hide manual price' : 'Set final manually'} <ChevronDown size={14} /></button>
    {advanced && <div className="manual-box"><PriceField label="Final cost override" cents={item.manualFinalCents ?? null} onChange={value => edit({ manualFinalCents: value })} /><button className="text-link" onClick={() => { edit({ manualFinalCents: null }); setAdvanced(false) }}>Use receipt calculation</button></div>}
    <div className="editor-navigation"><button onClick={onPrev}><ChevronLeft size={17} /> Previous item</button><button onClick={onNext}>Next item <ChevronRight size={17} /></button></div>
  </div>
}
export function SummaryPanel({ summary, setSummary, close, readonly = false }: { summary: ReceiptSummary; setSummary?: ReviewProps['setSummary']; close: () => void; readonly?: boolean }) {
  const update = (key: keyof ReceiptSummary, value: number | boolean) => {
    if (!setSummary) return
    const next = { ...summary, [key]: value }
    if (key !== 'totalCents' && key !== 'pricesIncludeTax') next.totalCents = next.subtotalCents - next.discountCents + next.taxCents + next.otherCents
    setSummary(next)
  }
  return <div className="overlay-shell" onClick={close}><div className="side-sheet summary-sheet" role="dialog" aria-modal="true" aria-label="Receipt summary" onClick={event => event.stopPropagation()}>
    <div className="editor-heading"><div><div className="eyebrow">COSTCO WHOLESALE / CAD</div><h2>Receipt summary</h2></div><button className="icon-button" onClick={close} aria-label="Close summary"><X size={20} /></button></div>
    <p className="summary-intro">{readonly ? 'The receipt totals entered by Alice.' : 'Use the printed totals to reconcile your items.'}</p>
    {([['subtotalCents', 'Subtotal'], ['discountCents', 'Receipt discount'], ['taxCents', 'HST (13%)'], ['otherCents', 'Other adjustments'], ['totalCents', 'Receipt total']] as const).map(([key, label]) => <label className={'summary-field ' + (key === 'totalCents' ? 'summary-total' : '')} key={key}><span>{label}</span>{readonly ? <strong>{money(summary[key])}</strong> : <SummaryAmount label={label} cents={summary[key]} onChange={value => update(key, value)} />}</label>)}
    <label className="summary-toggle">Prices include tax <input type="checkbox" disabled={readonly} checked={summary.pricesIncludeTax} onChange={event => update('pricesIncludeTax', event.target.checked)} /><span className="toggle-rail" /></label>
    <p className="helper-text">Item totals use each printed price minus its own savings, plus allocated receipt-wide tax and adjustments.</p>
  </div></div>
}
export function Reconciliation({ items, summary, onSummary, onNext }: { items: DerivedItem[]; summary: ReceiptSummary; onSummary: () => void; onNext: () => void }) {
  const total = items.reduce((sum, item) => sum + item.finalCents, 0)
  const difference = summary.totalCents - total
  return <footer className="sticky-footer"><button className="reconciliation" onClick={onSummary}><ReceiptText size={19} /><span>{difference === 0 ? <strong className="match"><Check size={15} /> Matches receipt</strong> : <><strong>Items {money(total)}</strong><span> · Receipt {money(summary.totalCents)} · <b>Off by {money(Math.abs(difference))}</b></span></>}<small>Tap for receipt summary</small></span><ChevronRight size={18} /></button><button className="primary-button next-button" onClick={onNext}>Next <ArrowRight size={16} /></button></footer>
}
export default function VariantA({ items, summary, updateItem, setSummary }: ReviewProps) {
  const [selected, setSelected] = useState<string | null>(null)
  const [filter, setFilter] = useState(false)
  const [summaryOpen, setSummaryOpen] = useState(false)
  const [step, setStep] = useState('Items')
  const derived = deriveCosts(items, summary)
  const flagged = derived.filter(needsCheck).length
  const visible = filter ? derived.filter(needsCheck) : derived
  const active = derived.find(item => item.id === selected)
  const move = (offset: number) => { const index = derived.findIndex(item => item.id === selected); setSelected(derived[(index + offset + derived.length) % derived.length].id) }
  // Scroll sync: the row nearest a reading line (just under the sticky mobile strip, or ~35% down on desktop) drives the photo.
  const [focused, setFocused] = useState<string | null>(null)
  const strip = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let frame = 0
    const update = () => {
      frame = 0
      const stripBox = strip.current?.offsetParent ? strip.current.getBoundingClientRect() : null
      const base = stripBox ? stripBox.bottom + 40 : window.innerHeight * 0.35
      // Near the end the page can't scroll further, so slide the reading line down toward the
      // footer; otherwise the last rows could never become current.
      const footerTop = document.querySelector('.sticky-footer')?.getBoundingClientRect().top ?? window.innerHeight
      const end = footerTop - 30, room = document.documentElement.scrollHeight - window.innerHeight - window.scrollY
      const span = Math.max(1, end - base), t = Math.min(1, Math.max(0, 1 - room / span))
      const reading = base + (end - base) * t
      let best: string | null = null, distance = Infinity
      for (const row of document.querySelectorAll<HTMLElement>('.variant-a .item-row[data-item-id]')) {
        const box = row.getBoundingClientRect(), d = Math.abs(box.top + box.height / 2 - reading)
        if (d < distance) { distance = d; best = row.dataset.itemId ?? null }
      }
      setFocused(best)
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update) }
    update()
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    return () => { window.removeEventListener('scroll', schedule); window.removeEventListener('resize', schedule); cancelAnimationFrame(frame) }
  }, [filter, step])
  const highlight = selected ?? focused ?? undefined
  return <><FlowHeader step={step} onStep={setStep} />{step !== 'Items' ? <Placeholder step={step} onBack={() => setStep('Items')} /> : <>
    <div className="variant-layout variant-a"><aside className="photo-aside"><div className="eyebrow">SOURCE RECEIPT</div><ReceiptImage items={items} highlight={highlight} summary={summary} mode="photo" /><p>Tap photo to zoom · The photo follows the list as you scroll</p></aside>
      <main className="review-main"><div className="variant-heading"><div className="eyebrow">OPTION A / LIST + SHEET</div><h2>Review your items</h2><p>A quick scan first. Tap anything that needs a closer look.</p></div>
        <div className="mobile-photo" ref={strip}><ReceiptImage items={items} highlight={highlight} summary={summary} mode="strip" /></div>
        <div className="filter-bar"><button className={!filter ? 'chip selected' : 'chip'} onClick={() => setFilter(false)}>All ({items.length})</button><button className={filter ? 'chip selected' : 'chip'} onClick={() => setFilter(true)}>Needs check ({flagged})</button></div>
        <div className="list-card">{visible.length ? visible.map(item => <ItemRow key={item.id} item={item} current={item.id === focused} onClick={() => setSelected(item.id)} />) : <p className="empty-message">All items checked. Nice work!</p>}</div>
      </main></div>
    <Reconciliation items={derived} summary={summary} onSummary={() => setSummaryOpen(true)} onNext={() => setStep('People')} />
    {active && <div className="overlay-shell" onClick={() => setSelected(null)}><div className="side-sheet" role="dialog" aria-modal="true" aria-label="Edit receipt item" onClick={event => event.stopPropagation()}><ItemEditor key={active.id} item={active} receiptItems={items} updateItem={updateItem} close={() => setSelected(null)} onPrev={() => move(-1)} onNext={() => move(1)} /></div></div>}
    {summaryOpen && <SummaryPanel summary={summary} setSummary={setSummary} close={() => setSummaryOpen(false)} />}
  </>}</>
}

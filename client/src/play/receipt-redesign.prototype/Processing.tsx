// PROTOTYPE — throwaway. The "Processing" state (Azure done, Luna naming items and checking tax)
// and its fallback, inside variant A. Three visual options P1–P3 share one simulated timeline.
import { useEffect, useRef, useState } from 'react'
import { ArrowRight, Check, ChevronRight, FilePenLine, Loader2, Lock, Plus, ReceiptText, TriangleAlert, X } from 'lucide-react'
import ReceiptImage from './ReceiptImage'
import { deriveCosts, initialItems, money, receiptInitial } from './mock-data'
import type { DerivedItem, Item, ReceiptSummary } from './mock-data'
import { FlowHeader, ItemEditor, Placeholder, SummaryPanel, needsCheck } from './VariantA'

export type Phase = 'processing' | 'ready' | 'fallback' | 'partial'
type Outcome = Exclude<Phase, 'processing'>
type Source = 'pending' | 'luna' | 'fallback'
type PItem = Item & { rawName: string; source: Source }
type PDerived = DerivedItem & PItem

const SIMULATED_MS = 7000 // real Luna timeout is 20 s; shortened for the demo
const PARTIAL_FROM = 19 // in the "partial" outcome Luna returns only the first 19 items

// Azure's raw description: the receipt line without its index, price and savings text.
const rawName = (text: string) => text.replace(/^\d+\s+/, '').replace(/\s*\|.*$/, '').replace(/\s+\$[\d?.]+$/, '').replace(/\s+[\d.]+\w* @ .*$/, '')

function itemsFor(phase: Phase): PItem[] {
  // v1 does not parse savings text merged into a line; the user types it into Instant savings.
  return initialItems.map((original, index) => {
    const item: Item = { ...original, discountCents: 0 }
    const raw = rawName(item.originalText)
    if (phase === 'processing') return { ...item, rawName: raw, name: raw, source: 'pending' }
    if (phase === 'fallback' || (phase === 'partial' && index >= PARTIAL_FROM)) return { ...item, rawName: raw, name: raw, taxable: true, source: 'fallback' }
    return { ...item, rawName: raw, source: 'luna' }
  })
}
const taxUnchecked = (item: PItem) => item.source === 'fallback' && !item.confirmed

type ViewProps = { phase: Phase; elapsed: number }

// Shared state for one variant screen. Keyed by phase, so each phase starts from fresh data.
function useScreen(phase: Phase) {
  const [items, setItems] = useState<PItem[]>(() => itemsFor(phase))
  const [summary, setSummary] = useState<ReceiptSummary>(receiptInitial)
  const [selected, setSelected] = useState<string | null>(null)
  const [summaryOpen, setSummaryOpen] = useState(false)
  const [step, setStep] = useState('Items')
  const locked = phase === 'processing'
  const updateItem = (id: string, patch: Partial<Item>) => { if (!locked) setItems(previous => previous.map(item => item.id === id ? { ...item, ...patch } : item)) }
  const derived = deriveCosts(items, summary) as PDerived[]
  const move = (offset: number) => { const index = derived.findIndex(item => item.id === selected); setSelected(derived[(index + offset + derived.length) % derived.length].id) }
  const printed = items.reduce((sum, item) => sum + (item.printedCents ?? 0) - item.discountCents, 0)
  const itemsTotal = derived.reduce((sum, item) => sum + item.finalCents, 0)
  return { items, summary, setSummary, selected, setSelected, summaryOpen, setSummaryOpen, step, setStep, locked, updateItem, derived, move, printed, itemsTotal }
}
type Screen = ReturnType<typeof useScreen>

// The item editor with every input disabled while processing; previous/next still work.
function Editor({ screen }: { screen: Screen }) {
  const box = useRef<HTMLDivElement>(null)
  const active = screen.derived.find(item => item.id === screen.selected)
  useEffect(() => {
    box.current?.querySelectorAll<HTMLInputElement | HTMLButtonElement>('.editor-fields input, .text-link, .manual-box input').forEach(element => { element.disabled = screen.locked })
  })
  if (!active) return null
  return <div className="overlay-shell" onClick={() => screen.setSelected(null)}><div ref={box} className={'side-sheet' + (screen.locked ? ' locked-editor' : '')} role="dialog" aria-modal="true" aria-label="Receipt item" onClick={event => event.stopPropagation()}>
    {screen.locked && <p className="lock-note"><Lock size={15} /><span>Checking the name and tax for this item. Editing unlocks when it finishes.<br /><b>Tax:</b> checking… · <b>Cost with tax:</b> after checking</span></p>}
    {active.source === 'fallback' && !active.confirmed && <p className="lock-note warn"><TriangleAlert size={15} /> Tax wasn't checked automatically, so this item is set to taxable. Turn it off if it isn't taxed.</p>}
    <ItemEditor key={active.id} item={active} receiptItems={screen.items} updateItem={screen.updateItem} close={() => screen.setSelected(null)} onPrev={() => screen.move(-1)} onNext={() => screen.move(1)} />
    {!screen.locked && active.source === 'fallback' && !active.confirmed && <button className="primary-button tax-ok" onClick={() => screen.updateItem(active.id, { confirmed: true })}><Check size={16} /> Tax setting is right</button>}
  </div></div>
}
function Photo({ screen }: { screen: Screen }) {
  return <aside className="photo-aside"><div className="eyebrow">SOURCE RECEIPT</div><ReceiptImage items={screen.items} highlight={screen.selected ?? undefined} summary={screen.summary} mode="photo" /></aside>
}
function MobilePhoto({ screen }: { screen: Screen }) {
  return <div className="mobile-photo"><ReceiptImage items={screen.items} highlight={screen.selected ?? undefined} summary={screen.summary} mode="strip" /></div>
}
function Overlays({ screen }: { screen: Screen }) {
  return <><Editor screen={screen} />{screen.summaryOpen && <SummaryPanel summary={screen.summary} setSummary={screen.locked ? undefined : screen.setSummary} readonly={screen.locked} close={() => screen.setSummaryOpen(false)} />}</>
}
function Price({ item, pending }: { item: PDerived; pending: boolean }) {
  if (item.printedCents === null && item.manualFinalCents == null) return <span className="item-row-price">—<ChevronRight size={16} /></span>
  return <span className={'item-row-price' + (pending ? ' pending-price' : '')}>{pending ? <><small>printed</small>{money((item.printedCents ?? 0) - item.discountCents)}</> : money(item.finalCents)}<ChevronRight size={16} /></span>
}
function Heading({ title, text }: { title: string; text: string }) {
  return <div className="variant-heading"><div className="eyebrow">PROCESSING PROTOTYPE</div><h2>{title}</h2><p>{text}</p></div>
}

/* ---------- P1: status banner above the list, per-row "Checking tax" chips ---------- */
function P1({ phase, elapsed }: ViewProps) {
  const screen = useScreen(phase)
  const [filter, setFilter] = useState<'all' | 'check' | 'tax'>('all')
  const [readyShown, setReadyShown] = useState(true)
  const unchecked = screen.items.filter(taxUnchecked).length
  const flagged = screen.derived.filter(needsCheck).length
  const visible = screen.derived.filter(item => filter === 'all' || (filter === 'check' ? needsCheck(item) : taxUnchecked(item)))
  if (screen.step !== 'Items') return <><FlowHeader step={screen.step} onStep={screen.setStep} /><Placeholder step={screen.step} onBack={() => screen.setStep('Items')} /></>
  return <><FlowHeader step={screen.step} onStep={screen.setStep} />
    <div className="variant-layout variant-a"><Photo screen={screen} /><main className="review-main">
      <Heading title="Review your items" text="P1 · Banner above the list, a chip on every row." />
      {phase === 'processing' && <div className="proc-banner"><Loader2 className="spin" size={20} /><div><strong>Naming items and checking tax…</strong><p>Usually about 10 seconds. You can look around; editing unlocks when this finishes.</p><div className="proc-bar"><span style={{ width: `${Math.min(96, elapsed / SIMULATED_MS * 100)}%` }} /></div></div></div>}
      {phase === 'ready' && readyShown && <div className="proc-banner ok"><Check size={20} /><div><strong>Names and tax filled in</strong><p>Everything is editable now. Fix anything that looks wrong.</p></div><button className="icon-button" aria-label="Dismiss" onClick={() => setReadyShown(false)}><X size={16} /></button></div>}
      {(phase === 'fallback' || phase === 'partial') && unchecked > 0 && <div className="proc-banner warn"><TriangleAlert size={20} /><div><strong>{phase === 'fallback' ? "Couldn't check tax automatically" : `Tax wasn't checked for ${unchecked} items`}</strong><p>{phase === 'fallback' ? 'All items are set to taxable and keep their receipt names.' : 'Those items are set to taxable and keep their receipt names.'} Turn tax off on items that aren't taxed.</p><button className="text-link" onClick={() => setFilter('tax')}>Show them ({unchecked}) <ArrowRight size={14} /></button></div></div>}
      <MobilePhoto screen={screen} />
      <div className="filter-bar"><button className={'chip' + (filter === 'all' ? ' selected' : '')} onClick={() => setFilter('all')}>All ({screen.items.length})</button><button className={'chip' + (filter === 'check' ? ' selected' : '')} onClick={() => setFilter('check')}>Needs check ({flagged})</button>{unchecked > 0 && <button className={'chip warn-chip' + (filter === 'tax' ? ' selected' : '')} onClick={() => setFilter('tax')}>Tax not checked ({unchecked})</button>}</div>
      <div className="list-card">{visible.map(item => <button key={item.id} className="item-row" onClick={() => screen.setSelected(item.id)}>
        <span className="item-row-main"><strong className={item.source !== 'luna' ? 'raw-name' : ''}>{item.name || 'Unnamed item'} {item.quantity !== 1 && <span className="quantity">×{item.quantity}</span>}</strong>
          <span className="row-badges">{needsCheck(item) && <span className="flag">{item.printedCents === null ? 'Missing price' : '⚠ Needs check'}</span>}
            {item.source === 'pending' ? <span className="checking-chip"><Loader2 className="spin" size={11} /> Checking tax</span> : taxUnchecked(item) ? <span className="warn-badge">Taxable · not checked</span> : !item.taxable && <span className="quiet-badge">No tax</span>}</span></span>
        <Price item={item} pending={item.source === 'pending'} /></button>)}
        {!visible.length && <p className="empty-message">All done here.</p>}</div>
    </main></div>
    <footer className="sticky-footer"><button className="reconciliation" onClick={() => screen.setSummaryOpen(true)}><ReceiptText size={19} /><span>{phase === 'processing' ? <><strong>Printed items {money(screen.printed)}</strong><span> · Receipt subtotal {money(screen.summary.subtotalCents)}</span><small>Tax is added after checking</small></> : <Recon screen={screen} />}</span><ChevronRight size={18} /></button>
      <span className="next-wrap"><button className="primary-button next-button" disabled={phase === 'processing'} onClick={() => screen.setStep('People')}>{phase === 'processing' && <Lock size={14} />}Next <ArrowRight size={16} /></button>{phase === 'processing' && <small>After checking</small>}</span></footer>
    <Overlays screen={screen} /></>
}
function Recon({ screen }: { screen: Screen }) {
  const difference = screen.summary.totalCents - screen.itemsTotal
  return difference === 0 ? <><strong className="match"><Check size={15} /> Matches receipt</strong><small>Tap for receipt summary</small></> : <><strong>Items {money(screen.itemsTotal)}</strong><span> · Receipt {money(screen.summary.totalCents)} · <b>Off by {money(Math.abs(difference))}</b></span><small>Tap for receipt summary</small></>
}

/* ---------- P2: quiet list with skeletons; the sticky footer carries the status ---------- */
function P2({ phase, elapsed }: ViewProps) {
  const screen = useScreen(phase)
  const [filter, setFilter] = useState<'all' | 'check'>('all')
  const needs = (item: PDerived) => needsCheck(item) || taxUnchecked(item)
  const flagged = screen.derived.filter(needs).length
  const unchecked = screen.items.filter(taxUnchecked).length
  const visible = screen.derived.filter(item => filter === 'all' || needs(item))
  if (screen.step !== 'Items') return <><FlowHeader step={screen.step} onStep={screen.setStep} /><Placeholder step={screen.step} onBack={() => screen.setStep('Items')} /></>
  return <><FlowHeader step={screen.step} onStep={screen.setStep} />
    <div className="variant-layout variant-a"><Photo screen={screen} /><main className="review-main">
      <Heading title="Review your items" text="P2 · No banner. Rows show skeletons; the bottom bar carries the status." />
      <MobilePhoto screen={screen} />
      <div className="filter-bar"><button className={'chip' + (filter === 'all' ? ' selected' : '')} onClick={() => setFilter('all')}>All ({screen.items.length})</button><button className={'chip' + (filter === 'check' ? ' selected' : '')} onClick={() => setFilter('check')}>Needs check ({flagged})</button></div>
      <div className="list-card">{visible.map(item => <button key={item.id} className="item-row" onClick={() => screen.setSelected(item.id)}>
        <span className="item-row-main">{item.source === 'pending' ? <><span className="skeleton-line" style={{ width: `${45 + (item.lineIndex * 17) % 35}%` }} /><span className="raw-caption">{item.rawName}</span></> : <>
          <strong className={item.source === 'fallback' ? 'raw-name' : ''}>{item.name} {item.quantity !== 1 && <span className="quantity">×{item.quantity}</span>}</strong>
          <span className="row-badges">{needsCheck(item) && <span className="flag">{item.printedCents === null ? 'Missing price' : '⚠ Needs check'}</span>}{taxUnchecked(item) ? <span className="warn-badge">Tax?</span> : !item.taxable && <span className="quiet-badge">No tax</span>}</span></>}</span>
        <Price item={item} pending={item.source === 'pending'} /></button>)}
        {!visible.length && <p className="empty-message">All done here.</p>}</div>
    </main></div>
    <footer className={'sticky-footer' + (phase === 'processing' ? ' footer-busy' : '')}>
      {phase === 'processing'
        ? <div className="reconciliation status-left"><Loader2 className="spin" size={19} /><span><strong>Checking names & tax · {Math.ceil(Math.max(0, SIMULATED_MS - elapsed) / 1000)}s</strong><small>Look around; editing unlocks after this</small></span></div>
        : unchecked > 0
          ? <button className="reconciliation warn-left" onClick={() => setFilter('check')}><TriangleAlert size={19} /><span><strong>Tax not checked on {unchecked} items</strong><small>Set to taxable · tap to review</small></span><ChevronRight size={18} /></button>
          : <button className="reconciliation" onClick={() => screen.setSummaryOpen(true)}><ReceiptText size={19} /><span><Recon screen={screen} /></span><ChevronRight size={18} /></button>}
      <button className="primary-button next-button" disabled={phase === 'processing'} onClick={() => screen.setStep('People')}>{phase === 'processing' ? <Lock size={15} /> : <>Next <ArrowRight size={16} /></>}</button></footer>
    <Overlays screen={screen} /></>
}

/* ---------- P3: a checklist card that stages the work; the list is dimmed until ready ---------- */
function P3({ phase, elapsed }: ViewProps) {
  const screen = useScreen(phase)
  const [filter, setFilter] = useState<'all' | 'tax'>('all')
  const [expanded, setExpanded] = useState(phase !== 'ready')
  const unchecked = screen.items.filter(taxUnchecked).length
  const visible = screen.derived.filter(item => filter === 'all' || taxUnchecked(item))
  const step2 = phase === 'processing' ? <><Loader2 className="spin" size={17} /><span><strong>Names & tax</strong><small>Checking… {Math.round(elapsed / 1000)}s</small></span></>
    : phase === 'ready' ? <><Check size={17} /><span><strong>Names & tax</strong><small>Filled in for all {screen.items.length} items</small></span></>
      : <><TriangleAlert size={17} /><span><strong>Names & tax</strong><small>{phase === 'fallback' ? 'Skipped (took too long): all items set to taxable, receipt names kept' : `Done for ${PARTIAL_FROM} items; ${screen.items.length - PARTIAL_FROM} set to taxable with receipt names`}</small></span></>
  if (screen.step !== 'Items') return <><FlowHeader step={screen.step} onStep={screen.setStep} /><Placeholder step={screen.step} onBack={() => screen.setStep('Items')} /></>
  return <><FlowHeader step={screen.step} onStep={screen.setStep} />
    <div className="variant-layout variant-a"><Photo screen={screen} /><main className="review-main">
      <Heading title="Review your items" text="P3 · A checklist card stages the work; the list stays dimmed until it's editable." />
      {expanded || phase !== 'ready' ? <div className={'checklist-card phase-' + phase}>
        <div className="check-step done"><Check size={17} /><span><strong>Receipt read</strong><small>{screen.items.length} lines · total {money(screen.summary.totalCents)}</small></span></div>
        <div className={'check-step ' + (phase === 'processing' ? 'active' : phase === 'ready' ? 'done' : 'warn')}>{step2}</div>
        <div className={'check-step ' + (phase === 'processing' ? 'todo' : 'done')}>{phase === 'processing' ? <Lock size={17} /> : <Check size={17} />}<span><strong>Ready to edit</strong><small>{phase === 'processing' ? 'You can look at items meanwhile' : 'Tap any item to edit'}</small></span></div>
        {unchecked > 0 && <button className="primary-button" onClick={() => setFilter('tax')}>Review tax on {unchecked} items</button>}
        {phase === 'ready' && <button className="text-link" onClick={() => setExpanded(false)}>Hide</button>}
      </div> : <button className="ready-pill" onClick={() => setExpanded(true)}><Check size={14} /> Names & tax filled in</button>}
      <MobilePhoto screen={screen} />
      {unchecked > 0 && <div className="filter-bar"><button className={'chip' + (filter === 'all' ? ' selected' : '')} onClick={() => setFilter('all')}>All ({screen.items.length})</button><button className={'chip warn-chip' + (filter === 'tax' ? ' selected' : '')} onClick={() => setFilter('tax')}>Tax not checked ({unchecked})</button></div>}
      <div className={'list-card' + (phase === 'processing' ? ' dimmed' : '')}>{visible.map(item => <button key={item.id} className="item-row" onClick={() => screen.setSelected(item.id)}>
        <span className="item-row-main"><strong className={item.source !== 'luna' ? 'raw-name' : ''}>{item.name} {item.quantity !== 1 && <span className="quantity">×{item.quantity}</span>}</strong>
          <span className="row-badges">{needsCheck(item) && <span className="flag">{item.printedCents === null ? 'Missing price' : '⚠ Needs check'}</span>}{taxUnchecked(item) ? <span className="warn-badge">Taxable · not checked</span> : item.source === 'luna' && !item.taxable && <span className="quiet-badge">No tax</span>}</span></span>
        <Price item={item} pending={item.source === 'pending'} /></button>)}
        {!visible.length && <p className="empty-message">All done here.</p>}</div>
    </main></div>
    <footer className="sticky-footer"><button className="reconciliation" onClick={() => screen.setSummaryOpen(true)}><ReceiptText size={19} /><span>{phase === 'processing' ? <><strong>Printed items {money(screen.printed)}</strong><small>Totals with tax appear after checking</small></> : <Recon screen={screen} />}</span><ChevronRight size={18} /></button>
      <button className="primary-button next-button" disabled={phase === 'processing'} onClick={() => screen.setStep('People')}>Next <ArrowRight size={16} /></button></footer>
    <Overlays screen={screen} /></>
}

/* ---------- The draft list elsewhere in the group, while this bill processes ---------- */
function DraftList({ phase, open }: { phase: Phase; open: () => void }) {
  const [started, setStarted] = useState(false)
  const status = phase === 'processing' ? <span className="draft-status busy"><Loader2 className="spin" size={13} /> Checking names & tax…</span>
    : phase === 'ready' ? <span className="draft-status ok"><Check size={13} /> Ready to review</span>
      : <span className="draft-status warn"><TriangleAlert size={13} /> Ready · tax not checked</span>
  return <main className="draft-demo"><div className="variant-heading"><div className="eyebrow">COSTCO FRIENDS · GROUP PAGE</div><h2>Your drafts</h2><p>Only you can see these. The first one is still processing; you can open it or start another bill.</p></div>
    <div className="list-card">
      <div className="draft-row"><FilePenLine size={22} /><div><strong>Costco run</strong><small>Split by items · 25 items read · {money(receiptInitial.totalCents)}</small>{status}</div><button className="secondary-button" onClick={open}>{phase === 'processing' ? 'View' : 'Continue'}</button></div>
      <div className="draft-row"><FilePenLine size={22} /><div><strong>Pizza night</strong><small>Split by amount · Saved 2:10 PM</small></div><button className="secondary-button">Continue</button></div>
      {started && <div className="draft-row"><FilePenLine size={22} /><div><strong>Untitled bill</strong><small>Just started · no receipt yet</small></div><button className="secondary-button">Continue</button></div>}
    </div>
    <button className="primary-button new-bill" onClick={() => setStarted(true)}><Plus size={16} /> New bill</button>
  </main>
}

/* ---------- Simulation controls + variant host ---------- */
export default function ProcessingPrototype({ variant }: { variant: 'P1' | 'P2' | 'P3' }) {
  const [phase, setPhase] = useState<Phase>('processing')
  const [outcome, setOutcome] = useState<Outcome>('ready')
  const [run, setRun] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const [drafts, setDrafts] = useState(false)
  const [panelOpen, setPanelOpen] = useState(() => window.innerWidth > 700)
  useEffect(() => {
    if (phase !== 'processing') return
    const start = Date.now()
    const timer = setInterval(() => { const spent = Date.now() - start; setElapsed(spent); if (spent >= SIMULATED_MS) setPhase(outcome) }, 250)
    return () => clearInterval(timer)
  }, [phase, outcome, run])
  const restart = (next: Outcome) => { setOutcome(next); setElapsed(0); setPhase('processing'); setRun(value => value + 1) }
  const View = variant === 'P1' ? P1 : variant === 'P2' ? P2 : P3
  const label: Record<Phase, string> = { processing: `PROCESSING · ${(elapsed / 1000).toFixed(1)}s → ${outcome}`, ready: 'READY · Luna returned', fallback: 'FALLBACK · Luna timed out', partial: 'PARTIAL · Luna missed 6 items' }
  return <>
    {drafts ? <DraftList phase={phase} open={() => setDrafts(false)} /> : <View key={`${phase}-${run}`} phase={phase} elapsed={elapsed} />}
    <div className={'sim-panel' + (panelOpen ? '' : ' closed')}>
      <button className="sim-title" onClick={() => setPanelOpen(value => !value)}>{panelOpen ? '▾' : '▸'} Simulation · {label[phase]}</button>
      {panelOpen && <div className="sim-buttons">
        <button onClick={() => restart('ready')}>▶ Run → Luna OK</button>
        <button onClick={() => restart('fallback')}>▶ Run → timeout</button>
        <button onClick={() => restart('partial')}>▶ Run → partial</button>
        {phase === 'processing' && <button onClick={() => setPhase(outcome)}>Skip wait</button>}
        <button className={drafts ? 'on' : ''} onClick={() => setDrafts(value => !value)}>{drafts ? 'Back to bill' : 'Draft list view'}</button>
      </div>}
    </div>
  </>
}

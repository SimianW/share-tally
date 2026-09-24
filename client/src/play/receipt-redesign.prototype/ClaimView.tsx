import { useState } from 'react'
import { ArrowLeft, Check, ChevronRight, ReceiptText, X } from 'lucide-react'
import ReceiptImage from './ReceiptImage'
import { deriveCosts, money, participants } from './mock-data'
import type { Item, ReceiptSummary, DerivedItem } from './mock-data'
import { SummaryPanel } from './VariantA'

type Claim = { person: string; share: number; confirmed?: boolean; fraction?: string }
const seedClaims = (items: Item[]): Record<string, Claim[]> => Object.fromEntries(items.map((item, index) => [item.id,
  index % 9 === 0 ? [{ person: 'bob', share: 1 / 2 }] : index % 7 === 0 ? [{ person: 'alice', share: 1 }] : index % 6 === 0 ? [{ person: 'carol', share: 1 / 2 }, { person: 'dan', share: 1 / 4 }] : index % 5 === 0 ? [{ person: 'bob', share: 1 / 3, confirmed: false }] : index % 4 === 0 ? [{ person: 'carol', share: 1 }] : [],
]))
const fractionLabel = (n: number) => n >= 1 - 1e-8 ? 'All claimed' : Math.abs(n - .5) < 1e-8 ? '½ left' : Math.abs(n - 2 / 3) < 1e-8 ? '⅓ left' : Math.abs(n - 1 / 3) < 1e-8 ? '⅔ left' : `${Math.round((1 - n) * 100)}% left`

export default function ClaimView({ items, summary }: { items: Item[]; summary: ReceiptSummary }) {
  const [claims, setClaims] = useState<Record<string, Claim[]>>(() => seedClaims(items))
  const [filter, setFilter] = useState<'Unclaimed' | 'Mine' | 'All'>('Unclaimed')
  const [selected, setSelected] = useState<string | null>(null)
  const [summaryOpen, setSummaryOpen] = useState(false)
  const [customOpen, setCustomOpen] = useState(false)
  const [numerator, setNumerator] = useState('1')
  const [denominator, setDenominator] = useState('4')
  const [confirmation, setConfirmation] = useState(false)
  const derived = deriveCosts(items, summary)
  const myFraction = (id: string) => (claims[id] ?? []).find(claim => claim.person === 'bob')?.fraction
  const mine = (id: string) => (claims[id] ?? []).find(claim => claim.person === 'bob')?.share ?? 0
  const used = (id: string) => (claims[id] ?? []).reduce((sum, claim) => sum + claim.share, 0)
  const remaining = (id: string) => 1 - used(id) + mine(id)
  const claim = (id: string, share: number, fraction?: string) => {
    setClaims(previous => ({ ...previous, [id]: [...(previous[id] ?? []).filter(person => person.person !== 'bob'), ...(share > 0 ? [{ person: 'bob', share, confirmed: false, fraction }] : [])] }))
    setCustomOpen(false)
  }
  const visible = derived.filter(item => filter === 'All' || (filter === 'Mine' ? mine(item.id) > 1e-8 : used(item.id) < 1 - 1e-8))
  const selectedItem = derived.find(item => item.id === selected)
  const yourShare = derived.reduce((sum, item) => sum + Math.round(item.finalCents * mine(item.id)), 0)
  const confirmCount = derived.filter(item => (claims[item.id] ?? []).some(person => person.person === 'bob' && !person.confirmed)).length
  const confirmedCount = derived.filter(item => (claims[item.id] ?? []).some(person => person.person === 'bob' && person.confirmed)).length
  const avatar = (person: string) => {
    const participant = participants.find(p => p.id === person)
    return <span className="claim-avatar" key={person} style={{ background: participant?.color ?? '#ddd' }} title={participant?.name ?? person}>{participant?.name.slice(0, 1) ?? '?'}</span>
  }
  const costNote = (item: DerivedItem) => item.manualFinalCents != null ? 'Set manually by Alice' : `Printed ${money(item.printedCents ?? 0)} − discount ${money(item.discountCents)} + tax ${money(item.taxShareCents)}${item.taxable ? ' (13%)' : ''} + adjustments ${money(item.otherShareCents - item.receiptDiscountShareCents)} = ${money(item.finalCents)}`
  return <><header className="flow-header claim-header"><div className="flow-heading"><button className="icon-button" aria-label="Back to bill" onClick={() => setConfirmation(false)}><ArrowLeft size={20} /></button><div><div className="eyebrow">COSTCO FRIENDS / RECEIPT</div><h1>Costco run <span>·</span> Split the haul</h1></div></div><div className="claim-header-sub">Paid by Alice <span>·</span> Your share <strong>{money(yourShare)}</strong></div></header>
    <div className="claim-layout"><aside className="photo-aside"><div className="eyebrow">SOURCE RECEIPT</div><ReceiptImage items={items} highlight={selected ?? undefined} summary={summary} mode="photo" /></aside><main className="claim-main"><div className="variant-heading"><div className="eyebrow">PARTICIPANT / BOB'S VIEW</div><h2>What did you take?</h2><p>Claim only your portion. Your friends can claim theirs.</p></div>
      <div className="filter-bar">{(['Unclaimed', 'Mine', 'All'] as const).map(chip => <button key={chip} className={'chip ' + (filter === chip ? 'selected' : '')} onClick={() => setFilter(chip)}>{chip} {chip === 'Unclaimed' ? `(${derived.filter(item => used(item.id) < 1 - 1e-8).length})` : chip === 'Mine' ? `(${derived.filter(item => mine(item.id) > 1e-8).length})` : `(${derived.length})`}</button>)}</div>
      {confirmation && <div className="confirmation-banner"><Check size={18} /> Your {confirmedCount} items are confirmed locally for this demo.</div>}
      <div className="list-card claim-list">{visible.length ? visible.map(item => { const taken = used(item.id); return <button className="claim-row" key={item.id} onClick={() => { setSelected(item.id); setCustomOpen(false) }}><span className="claim-row-top"><strong>{item.name}</strong><b>{money(item.finalCents)}</b></span><span className="claim-row-bottom"><span className="avatar-stack">{(claims[item.id] ?? []).map(person => avatar(person.person))}{!taken && <small>No claims yet</small>}</span><span>{mine(item.id) > 1e-8 && <em>Yours {Math.round(mine(item.id) * 100)}% · </em>}{fractionLabel(taken)}</span></span><span className="claim-progress" aria-label={`${Math.round(taken * 100)} percent claimed`}><span style={{ width: `${taken * 100}%` }} /></span></button> }) : <p className="empty-message">No items in this view yet.</p>}</div>
    </main></div>
    <footer className="sticky-footer claim-footer"><button className="reconciliation" onClick={() => setSummaryOpen(true)}><ReceiptText size={19} /><span><strong>Your share {money(yourShare)}</strong><small>Receipt summary · {confirmCount} to confirm</small></span><ChevronRight size={18} /></button><button className="primary-button next-button" onClick={() => { setClaims(previous => Object.fromEntries(Object.entries(previous).map(([id, people]) => [id, people.map(person => person.person === 'bob' ? { ...person, confirmed: true } : person)]))); setConfirmation(true) }}>Confirm {confirmCount} items</button></footer>
    {selectedItem && <div className="overlay-shell" onClick={() => setSelected(null)}><div className="side-sheet claim-sheet" role="dialog" aria-modal="true" aria-label="Claim item" onClick={event => event.stopPropagation()}><div className="editor-heading"><div><div className="eyebrow">CLAIM YOUR SHARE</div><h2>{selectedItem.name}</h2></div><button className="icon-button" aria-label="Close claim" onClick={() => setSelected(null)}><X size={20} /></button></div><div className="editor-photo"><ReceiptImage items={items} highlight={selectedItem.id} summary={summary} mode="crop" /></div><div className="original-text"><span>ON THE RECEIPT</span><code>{selectedItem.originalText}</code></div><div className="claim-cost"><span>HOW THIS COST WAS CALCULATED</span><p>{costNote(selectedItem)}</p></div><div className="claim-remaining">{money(selectedItem.finalCents)} total <strong>{fractionLabel(used(selectedItem.id))}</strong></div>
      <button className="primary-button claim-all" disabled={remaining(selectedItem.id) < 1 - 1e-8} onClick={() => claim(selectedItem.id, 1)}>All of it · {money(selectedItem.finalCents)}</button>
      <p className="portion-label">Or just your portion</p>
      <div className="portion-grid">{[2, 3, 4, 5, 6].map(n => <button key={n} className={'secondary-button' + (!customOpen && !myFraction(selectedItem.id) && Math.abs(mine(selectedItem.id) - 1 / n) < 1e-8 ? ' chosen' : '')} disabled={1 / n > remaining(selectedItem.id) + 1e-8} onClick={() => claim(selectedItem.id, 1 / n)}><b>1/{n}</b><small>{money(Math.round(selectedItem.finalCents / n))}</small></button>)}<button className={'secondary-button' + (customOpen || myFraction(selectedItem.id) ? ' chosen' : '')} onClick={() => setCustomOpen(value => !value)}><b>Custom</b>{myFraction(selectedItem.id) && !customOpen && <small>{myFraction(selectedItem.id)} · {money(Math.round(selectedItem.finalCents * mine(selectedItem.id)))}</small>}</button></div>
      {customOpen && <div className="claim-extra"><div className="fraction-fields"><input aria-label="Numerator" type="number" min="1" value={numerator} onChange={event => setNumerator(event.target.value)} /><span> / </span><input aria-label="Denominator" type="number" min="1" value={denominator} onChange={event => setDenominator(event.target.value)} /></div><button className="primary-button" disabled={Number(denominator) <= 0 || Number(numerator) <= 0 || Number(numerator) / Number(denominator) > remaining(selectedItem.id) + 1e-8} onClick={() => claim(selectedItem.id, Number(numerator) / Number(denominator), `${Number(numerator)}/${Number(denominator)}`)}>Claim this portion</button></div>}
      {mine(selectedItem.id) > 0 && <button className="text-link" onClick={() => claim(selectedItem.id, 0)}>Remove my claim</button>}
    </div></div>}
    {summaryOpen && <SummaryPanel summary={summary} readonly close={() => setSummaryOpen(false)} />}
  </>
}

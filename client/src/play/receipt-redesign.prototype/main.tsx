// PROTOTYPE — throwaway. Three review-list variants + claim view for the receipt-item redesign, switchable via ?variant=A|B|C|claim.
/* eslint-disable react-refresh/only-export-components -- Standalone Vite entry point. */
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../fonts.css'
import './prototype.css'
import { initialItems, receiptInitial } from './mock-data'
import type { Item, ReceiptSummary } from './mock-data'
import VariantA from './VariantA'
import VariantB from './VariantB'
import VariantC from './VariantC'
import ClaimView from './ClaimView'
import Switcher from './Switcher'
import type { Variant } from './Switcher'

function readVariant(): Variant {
  const value = new URLSearchParams(window.location.search).get('variant')
  return value === 'B' || value === 'C' || value === 'claim' ? value : 'A'
}

function App() {
  const [variant, setVariant] = useState<Variant>(readVariant)
  const [items, setItems] = useState<Item[]>(initialItems)
  const [summary, setSummary] = useState<ReceiptSummary>(receiptInitial)
  const updateItem = (id: string, patch: Partial<Item>) => setItems(previous => previous.map(item => item.id === id ? { ...item, ...patch } : item))
  const onVariant = (next: Variant) => {
    const url = new URL(window.location.href)
    url.searchParams.set('variant', next)
    window.history.replaceState(null, '', url)
    setVariant(next)
  }
  const props = { items, summary, updateItem, setSummary }
  return <div className="receipt-prototype">
    {variant === 'A' && <VariantA {...props} />}
    {variant === 'B' && <VariantB {...props} />}
    {variant === 'C' && <VariantC {...props} />}
    {variant === 'claim' && <ClaimView items={items} summary={summary} />}
    <Switcher variant={variant} onChange={onVariant} />
  </div>
}

createRoot(document.getElementById('root')!).render(<App />)

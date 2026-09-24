/* eslint-disable react-refresh/only-export-components -- Throwaway prototype shares controls within its variants. */
import { useEffect } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

export const variants = ['P1', 'P2', 'P3', 'A', 'B', 'C', 'claim'] as const
export type Variant = typeof variants[number]
const labels: Record<Variant, string> = {
  P1: 'P1 · Processing: banner', P2: 'P2 · Processing: quiet + footer', P3: 'P3 · Processing: checklist',
  A: 'A · List + sheet', B: 'B · Review queue', C: 'C · Receipt mirror', claim: 'Claim · Participant view',
}

export default function Switcher({ variant, onChange }: { variant: Variant; onChange: (next: Variant) => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || target?.closest('input, textarea, select, [contenteditable="true"]')) return
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault()
        const offset = event.key === 'ArrowLeft' ? -1 : 1
        onChange(variants[(variants.indexOf(variant) + offset + variants.length) % variants.length])
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [variant, onChange])
  if (!import.meta.env.DEV) return null
  const move = (offset: number) => onChange(variants[(variants.indexOf(variant) + offset + variants.length) % variants.length])
  return <nav className="prototype-switcher" aria-label="Prototype variants">
    <button aria-label="Previous variant" onClick={() => move(-1)}><ChevronLeft size={19} /></button>
    <span>{labels[variant]}</span>
    <button aria-label="Next variant" onClick={() => move(1)}><ChevronRight size={19} /></button>
  </nav>
}

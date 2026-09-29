/* eslint-disable react-refresh/only-export-components -- Prototype switch shares its hook and type with the variants. */
// PROTOTYPE — throwaway. Question: "What should the bill detail page look like?"
// Variants on the existing #/bills/:id route, switchable via `?variant=A|B|C|D1|D2|D3|E`
// (in location.search, so it survives hash navigation) and the floating bar.
// A is the group-page-aligned redesign in Bills.tsx; B–E are alternatives.
// Dev builds only. Delete this file, the variant files, and the hook in
// BillDetails once a direction is chosen.
import { useEffect, useState, type ReactNode } from "react";
import type { Bill } from "./bill-api";
import { BillVariantB } from "./BillVariantB.prototype";
import { BillVariantC } from "./BillVariantC.prototype";
import { BillVariantD1, BillVariantD2, BillVariantD3 } from "./BillVariantD.prototype";
import { BillVariantE } from "./BillVariantE.prototype";
import "./bill-variants.prototype.css";

export type Participant = Bill["participants"][number];

// Everything a variant needs. Variants own layout; the notices and actions are
// the real, working components and should be placed, not reimplemented.
export type BillVariantProps = {
  bill: Bill;
  initiator: Participant;
  own: Participant | undefined;
  /** Callback ref for the page <h1>; it receives focus after saves. */
  headingRef: (element: HTMLHeadingElement | null) => void;
  backHref: string;
  status: { label: string; tone: "open" | "done" | "warning" | "muted" };
  needsAmountCorrection: boolean;
  /** Unconfirmed participants, current user first. */
  waiting: Participant[];
  /** Initiator's cost after the difference is assigned to them. */
  initiatorCost: number;
  /** Error / success / correction notifications, already rendered. */
  notices: ReactNode;
  /** The current user's share form or item claims (null if not a participant). */
  shareAction: ReactNode;
  /** Initiator edit/cancel controls (null if not initiator or bill is final). */
  initiatorActions: ReactNode;
};

const variants = {
  A: { name: "Group-page cards (current)", render: null },
  B: { name: "Printed receipt", render: BillVariantB },
  C: { name: "Split bar", render: BillVariantC },
  D1: { name: "Your share first · quiet card", render: BillVariantD1 },
  D2: { name: "Your share first · ticket stub", render: BillVariantD2 },
  D3: { name: "Your share first · my steps", render: BillVariantD3 },
  E: { name: "Confirmation timeline", render: BillVariantE },
} as const;
type Key = keyof typeof variants;
const keys = Object.keys(variants) as Key[];

function read(): Key {
  const value = new URLSearchParams(window.location.search).get("variant")?.toUpperCase();
  return keys.includes(value as Key) ? (value as Key) : "A";
}

export function useBillVariant() {
  const [variant, setVariant] = useState<Key>(read);
  useEffect(() => {
    const sync = () => setVariant(read());
    window.addEventListener("popstate", sync);
    window.addEventListener("bill-variant", sync);
    return () => { window.removeEventListener("popstate", sync); window.removeEventListener("bill-variant", sync); };
  }, []);
  return import.meta.env.DEV ? variant : "A";
}

function go(step: number) {
  const next = keys[(keys.indexOf(read()) + step + keys.length) % keys.length];
  const url = new URL(window.location.href);
  url.searchParams.set("variant", next);
  window.history.replaceState(window.history.state, "", url);
  window.dispatchEvent(new Event("bill-variant"));
  window.scrollTo({ top: 0 });
}

export function BillVariantSwitch({ variant, props, current }: { variant: Key; props: BillVariantProps; current: ReactNode }) {
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable]")) return;
      if (event.key === "ArrowLeft") go(-1);
      if (event.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  const Render = variants[variant].render;
  return <>
    {Render ? <Render {...props} /> : current}
    {import.meta.env.DEV && <div className="prototype-switcher" role="toolbar" aria-label="Prototype variant">
      <button type="button" onClick={() => go(-1)} aria-label="Previous variant">←</button>
      <span><b>{variant}</b> {variants[variant].name}</span>
      <button type="button" onClick={() => go(1)} aria-label="Next variant">→</button>
    </div>}
  </>;
}

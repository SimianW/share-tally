/* eslint-disable react-refresh/only-export-components -- throwaway prototype */
// PROTOTYPE — throwaway entry, served by client/prototype-claim-review.html.
// Three variants of the item-claims page, switchable via ?variant=A|B|C, answering:
// "What should per-item re-review and over-allocation look like, and how do live
// changes by other participants look?" Skips App/Clerk entirely; all data is in memory.
import { StrictMode, useEffect, useReducer, useState } from "react";
import { createRoot } from "react-dom/client";
import { MotionConfig } from "motion/react";
import "../../index.css";
import "../play.css";
import "../receipts.css";
import "../receipt-review.css";
import "../notification.css";
import "./prototype.css";
import { counts, initialState, reducer, type Sim } from "./model";
import { Chrome, type VariantMeta } from "./Chrome";
import type { VariantProps } from "./variant-props";
import { VariantA } from "./VariantA";
import { VariantB } from "./VariantB";
import { VariantC } from "./VariantC";

const variants: (VariantMeta & { Component: (props: VariantProps) => React.ReactNode })[] = [
  { key: "A", name: "Inline badges", Component: VariantA },
  { key: "B", name: "Guided review", Component: VariantB },
  { key: "C", name: "Attention inbox", Component: VariantC },
];

function PrototypeApp() {
  const [state, dispatch] = useReducer(reducer, undefined, initialState);
  const [variant, setVariantState] = useState(() => new URLSearchParams(location.search).get("variant")?.toUpperCase() ?? "A");
  const [busy, setBusy] = useState(false);
  const [simOpen, setSimOpen] = useState(() => new URLSearchParams(location.search).get("sim") !== "closed");
  const [target, setTarget] = useState("fish");
  const [, tick] = useState(0);
  // Re-render each second so time-boxed highlights and the saved note expire.
  useEffect(() => { const id = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(id); }, []);
  function setVariant(key: string) {
    const url = new URL(location.href);
    url.searchParams.set("variant", key);
    history.replaceState(null, "", url);
    setVariantState(key);
  }
  function confirm() {
    if (busy || counts(state).total) return;
    setBusy(true);
    setTimeout(() => { dispatch({ type: "confirm" }); setBusy(false); }, 600);
  }
  function simulate(sim: Sim, id: string) {
    if (sim !== "conflict") return dispatch({ type: "sim", sim, target: id });
    // The conflict is A's own Confirm failing, so show the save in flight first.
    setBusy(true);
    setTimeout(() => { dispatch({ type: "sim", sim, target: id }); setBusy(false); }, 700);
  }
  const current = variants.find((v) => v.key === variant) ?? variants[0];
  return <div className="pcr-root" data-variant={current.key}>
    <current.Component key={current.key} state={state} dispatch={dispatch} busy={busy} confirm={confirm} />
    <Chrome state={state} simulate={simulate} reset={() => dispatch({ type: "reset" })} open={simOpen} setOpen={setSimOpen}
      target={target} setTarget={setTarget} variants={variants} current={current.key} setVariant={setVariant} />
  </div>;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      <PrototypeApp />
    </MotionConfig>
  </StrictMode>,
);

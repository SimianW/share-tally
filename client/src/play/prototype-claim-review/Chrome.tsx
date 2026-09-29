// PROTOTYPE — throwaway chrome: the Simulate panel and the variant switcher.
// Both are portalled into the open <dialog> when there is one, because a modal
// dialog makes the rest of the page inert and the panel must stay usable.
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, FlaskConical, X } from "lucide-react";
import { counts, isSelected, mineOf, othersOf, people, text, type Sim, type State } from "./model";

function useOpenDialog() {
  const [dialog, setDialog] = useState<HTMLDialogElement | null>(null);
  useEffect(() => {
    const update = () => { const open = document.querySelectorAll<HTMLDialogElement>("dialog[open]"); setDialog(open[open.length - 1] ?? null); };
    const observer = new MutationObserver(update);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["open"] });
    update();
    return () => observer.disconnect();
  }, []);
  return dialog;
}

export function Chrome(props: SimProps & SwitchProps) {
  const host = useOpenDialog();
  // The switcher stays on the page (under the sheet's backdrop); arrow keys still work.
  return <>
    {createPortal(<SimulatePanel {...props} />, host ?? document.body)}
    {import.meta.env.DEV && <Switcher {...props} />}
  </>;
}

type SimProps = { state: State; simulate: (sim: Sim, target: string) => void; reset: () => void; open: boolean; setOpen: (open: boolean) => void;
  target: string; setTarget: (id: string) => void };
function SimulatePanel({ state, simulate, reset, open, setOpen, target, setTarget }: SimProps) {
  const item = state.items.find((i) => i.id === target) ?? state.items[0];
  useEffect(() => { if (!state.items.some((i) => i.id === target) && state.items[0]) setTarget(state.items[0].id); }, [state.items, target, setTarget]);
  const name = item?.name ?? "item";
  const { review, over } = counts(state);
  if (!open) return <button type="button" className="pcr-sim-toggle" onClick={() => setOpen(true)}><FlaskConical size={16} aria-hidden="true" />Simulate</button>;
  const button = (sim: Sim, label: string, hint?: string) =>
    <button type="button" onClick={() => { simulate(sim, target); if (matchMedia("(max-width: 700px)").matches) setOpen(false); }}>{label}{hint && <small>{hint}</small>}</button>;
  return <aside className="pcr-sim" aria-label="Prototype simulator">
    <div className="pcr-sim-head"><strong><FlaskConical size={15} aria-hidden="true" /> Prototype simulator</strong>
      <button type="button" aria-label="Hide simulator" onClick={() => setOpen(false)}><X size={16} /></button></div>
    <label className="pcr-sim-target">Target item
      <select value={target} onChange={(e) => setTarget(e.target.value)}>
        {state.items.map((i) => <option key={i.id} value={i.id}>{i.name}{isSelected(state, i.id) ? " (yours)" : ""}</option>)}
      </select>
    </label>
    <div className="pcr-sim-group"><span>Other participants save (live, ~1s)</span>
      {button("benMore", `Ben claims more of ${name}`, "grow + highlight")}
      {button("chloeRelease", "Chloe releases her claim", "shrink; target item, else her first")}
      {button("benRest", "Ben takes the rest", "forces your pick over; target if yours")}
    </div>
    <div className="pcr-sim-group"><span>Initiator (Dev) edits the bill</span>
      {button("price", `Change price of ${name}`, "+25%")}
      {button("rename", `Rename ${name}`)}
      {button("taxShift", "Correct receipt tax", "every final cost shifts")}
      {button("add", "Add an item")}
      {button("removeSelected", "Remove an item you selected", "target if yours")}
      {button("removeOther", "Remove an item you didn't select", "never blocks")}
    </div>
    <div className="pcr-sim-group"><span>Your save</span>
      {button("conflict", "Simulate save-time conflict", "Confirm races Dev's save")}
      <button type="button" className="is-reset" onClick={reset}>Reset everything</button>
    </div>
    <details className="pcr-sim-state">
      <summary>State · {review} to review · {over} over</summary>
      <table><tbody>{state.items.map((i) => <tr key={i.id}>
        <td>{i.name}</td>
        <td>{othersOf(i).map((o) => `${people[o.person].name[0]} ${text(o.f)}`).join(", ") || "—"}</td>
        <td>{mineOf(state, i.id) ? `you ${state.draft[i.id]}${state.saved[i.id] === state.draft[i.id] ? "" : "*"}` : ""}</td>
      </tr>)}</tbody></table>
      <small>* unsaved draft</small>
    </details>
    <ol className="pcr-sim-log">{state.log.slice(0, 4).map((entry) => <li key={entry.at + entry.text}>{entry.text}</li>)}</ol>
  </aside>;
}

export type VariantMeta = { key: string; name: string };
type SwitchProps = { variants: VariantMeta[]; current: string; setVariant: (key: string) => void };
function Switcher({ variants, current, setVariant }: SwitchProps) {
  const index = Math.max(0, variants.findIndex((v) => v.key === current));
  const go = (step: number) => setVariant(variants[(index + step + variants.length) % variants.length].key);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || (el as HTMLElement | null)?.isContentEditable) return;
      if (event.key === "ArrowLeft") go(-1);
      if (event.key === "ArrowRight") go(1);
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  });
  return <nav className="pcr-switcher" aria-label="Prototype variants">
    <button type="button" aria-label="Previous variant" onClick={() => go(-1)}><ChevronLeft size={18} /></button>
    <span><b>{variants[index].key}</b> {variants[index].name}</span>
    <button type="button" aria-label="Next variant" onClick={() => go(1)}><ChevronRight size={18} /></button>
  </nav>;
}

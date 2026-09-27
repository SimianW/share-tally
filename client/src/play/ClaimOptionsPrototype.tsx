/* eslint-disable react-refresh/only-export-components -- Throwaway prototype module. */
// PROTOTYPE — throwaway variants of the claim sheet's portion picker (?variant=B..E).
// Variant A is the current production markup in ClaimItems. Delete after a winner is chosen.
import type { ReactNode } from "react";
import { money } from "./bill-api";
import { cost, lessOrEqual, one, parse, subtract, text } from "./claim-fractions";
import "./claim-options-prototype.css";

type Fraction = NonNullable<ReturnType<typeof parse>>;
export type ClaimOptionsProps = {
  finalCents: number;
  room: Fraction;
  selected: Fraction | null;
  customSelected: boolean;
  customValue?: string;
  customOpen: boolean;
  busy: boolean;
  choose: (value: string) => void;
  openCustom: () => void;
  customEditor: ReactNode;
  removeButton: ReactNode;
};

export const claimOptionVariants = [
  { key: "A", name: "Current" },
  { key: "B", name: "Split bar" },
  { key: "C", name: "Pie tiles" },
  { key: "D", name: "People stepper" },
  { key: "E", name: "Choice list" },
];

const presets = [
  { d: 1, word: "All of it" },
  { d: 2, word: "Half" },
  { d: 3, word: "A third" },
  { d: 4, word: "A quarter" },
  { d: 5, word: "A fifth" },
  { d: 6, word: "A sixth" },
];
const unit = (d: number): Fraction => ({ n: 1n, d: BigInt(d) });
// Stacked numerals render the same in every palette font; Unicode ⅕/⅙ fall back to another font.
function Frac({ d, n = 1 }: { d: number | bigint; n?: number | bigint }) {
  return <span className="cop-frac"><sup>{String(n)}</sup><span>/</span><sub>{String(d)}</sub></span>;
}
const same = (a: Fraction | null, b: Fraction) => !!a && a.n === b.n && a.d === b.d;
const percent = (f: Fraction) => Number((f.n * 10000n) / f.d) / 100;

export function ClaimOptionsPrototype({ variant, ...props }: ClaimOptionsProps & { variant: string }) {
  const body = variant === "B" ? <SplitBar {...props} /> : variant === "C" ? <PieTiles {...props} /> : variant === "D" ? <PeopleStepper {...props} /> : <ChoiceList {...props} />;
  return <div className="cop">
    {body}
    {props.customOpen && props.customEditor}
    {props.removeButton}
  </div>;
}

// B: one segmented control, a big readout, and a bar that shows what others already hold.
function SplitBar({ finalCents, room, selected, customSelected, customValue, customOpen, busy, choose, openCustom }: ClaimOptionsProps) {
  const others = subtract(one, room);
  const mine = selected && !customOpen ? selected : null;
  return <div className="cop-b">
    <div className="cop-b-readout">
      <span className="eyebrow">YOUR SHARE</span>
      <strong className={mine ? "" : "cop-b-empty"}>{money(mine ? cost(finalCents, mine) : 0)}</strong>
      <span>{mine ? `${text(mine)} of ${money(finalCents)}` : `Pick a portion of ${money(finalCents)}`}</span>
    </div>
    <div className="cop-b-bar" aria-hidden="true">
      {others.n > 0n && <span className="cop-b-others" style={{ width: `${percent(others)}%` }} />}
      {mine && <span className="cop-b-mine" style={{ width: `${percent(mine)}%` }} />}
    </div>
    <div className="cop-b-legend">
      <span><i className="cop-b-key-mine" />You</span>
      {others.n > 0n && <span><i className="cop-b-key-others" />Others · {text(others)}</span>}
      <span><i />Free · {text(subtract(room, mine ?? { n: 0n, d: 1n }))}</span>
    </div>
    <div className="cop-b-seg" role="group" aria-label="Portion">
      {presets.map(({ d }) => {
        const f = unit(d);
        return <button type="button" key={d} aria-pressed={!customOpen && !customSelected && same(selected, f)} disabled={busy || !lessOrEqual(f, room)}
          aria-label={`${d === 1 ? "All of it" : text(f)} · ${money(cost(finalCents, f))}`} onClick={() => choose(text(f))}>
          <b>{d === 1 ? "All" : <Frac d={d} />}</b><small>{money(cost(finalCents, f))}</small>
        </button>;
      })}
      <button type="button" aria-pressed={customOpen || customSelected} disabled={busy || room.n <= 0n} aria-label="Custom" onClick={openCustom}>
        <b>{customSelected && customValue ? customValue : "…"}</b><small>Custom</small>
      </button>
    </div>
  </div>;
}

function Pie({ f, size = 44 }: { f: Fraction; size?: number }) {
  const r = size / 2 - 2, c = size / 2;
  const angle = 2 * Math.PI * (Number(f.n) / Number(f.d));
  const x = c + r * Math.sin(angle), y = c - r * Math.cos(angle);
  return <svg className="cop-pie" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
    <circle cx={c} cy={c} r={r} className="cop-pie-base" />
    {f.n >= f.d ? <circle cx={c} cy={c} r={r} className="cop-pie-slice" />
      : <path className="cop-pie-slice" d={`M${c},${c} L${c},${c - r} A${r},${r} 0 ${angle > Math.PI ? 1 : 0} 1 ${x},${y} Z`} />}
  </svg>;
}

// C: each option draws its own slice, so the size of a portion is visible before reading it.
function PieTiles({ finalCents, room, selected, customSelected, customValue, customOpen, busy, choose, openCustom }: ClaimOptionsProps) {
  const custom = customSelected && customValue ? parse(customValue) : null;
  return <div className="cop-c" role="group" aria-label="Portion">
    {presets.map(({ d, word }) => {
      const f = unit(d);
      const pressed = !customOpen && !customSelected && same(selected, f);
      return <button type="button" key={d} className="cop-c-tile" aria-pressed={pressed} disabled={busy || !lessOrEqual(f, room)}
        aria-label={`${d === 1 ? "All of it" : text(f)} · ${money(cost(finalCents, f))}`} onClick={() => choose(text(f))}>
        <Pie f={f} size={40} />
        <span className="cop-c-label">{d === 1 ? word : <Frac d={d} />}</span>
        <span className="cop-c-price">{money(cost(finalCents, f))}</span>
      </button>;
    })}
    <button type="button" className="cop-c-tile cop-c-custom" aria-pressed={customOpen || customSelected} disabled={busy || room.n <= 0n} aria-label="Custom" onClick={openCustom}>
      {custom ? <Pie f={custom} size={36} /> : <span className="cop-c-plus">+</span>}
      <span><span className="cop-c-label">{custom ? <Frac n={custom.n} d={custom.d} /> : "Custom"}</span>
        <span className="cop-c-price">{custom ? money(cost(finalCents, custom)) : "Any fraction"}</span></span>
    </button>
  </div>;
}

// D: "how many people share it" instead of picking a fraction.
function PeopleStepper({ finalCents, room, selected, customSelected, customValue, customOpen, busy, choose, openCustom }: ClaimOptionsProps) {
  const n = selected && selected.n === 1n && !customSelected && !customOpen ? Number(selected.d) : null;
  const fits = (k: number) => k >= 1 && k <= 20 && lessOrEqual(unit(k), room);
  const smallest = Array.from({ length: 20 }, (_, i) => i + 1).find(fits) ?? null;
  const custom = customSelected && customValue ? parse(customValue) : null;
  return <div className="cop-d">
    <span className="eyebrow">SPLIT BETWEEN</span>
    <div className="cop-d-stepper">
      <button type="button" aria-label="Fewer people" disabled={busy || !n || !fits(n - 1)} onClick={() => n && choose(text(unit(n - 1)))}>−</button>
      <output aria-live="polite">
        <strong className={n ? "" : "cop-d-empty"}>{n ?? "?"}</strong>
        <span>{n === 1 ? "just you" : "people"}</span>
      </output>
      <button type="button" aria-label="More people" disabled={busy || (n ? !fits(n + 1) : smallest == null)} onClick={() => choose(text(unit(n ? n + 1 : Math.max(2, smallest!))))}>+</button>
    </div>
    {n && <div className="cop-d-people" aria-hidden="true">
      {Array.from({ length: n }, (_, i) => <span key={i} className={i === 0 && n ? "cop-d-you" : ""}>{i === 0 && n ? "You" : ""}</span>)}
    </div>}
    <p className="cop-d-result">
      {n ? <>You pay <strong>{money(cost(finalCents, unit(n)))}</strong> · {text(unit(n))} of {money(finalCents)}</>
        : custom ? <>You pay <strong>{money(cost(finalCents, custom))}</strong> · custom {customValue}</>
          : <>Tap + to start splitting {money(finalCents)}</>}
    </p>
    <div className="cop-d-chips">
      <button type="button" aria-pressed={n === 1} disabled={busy || !fits(1)} onClick={() => choose("1")}>Just me · {money(finalCents)}</button>
      <button type="button" aria-pressed={customOpen || customSelected} disabled={busy || room.n <= 0n} onClick={openCustom}>Uneven split…</button>
    </div>
  </div>;
}

// E: a single-choice list in words, with a reason on every unavailable option.
function ChoiceList({ finalCents, room, selected, customSelected, customValue, customOpen, busy, choose, openCustom }: ClaimOptionsProps) {
  const custom = customSelected && customValue ? parse(customValue) : null;
  return <div className="cop-e" role="radiogroup" aria-label="Portion">
    {presets.map(({ d, word }) => {
      const f = unit(d);
      const available = lessOrEqual(f, room);
      const checked = !customOpen && !customSelected && same(selected, f);
      return <button type="button" role="radio" key={d} className="cop-e-row" aria-checked={checked} disabled={busy || !available}
        aria-label={`${d === 1 ? "All of it" : text(f)} · ${money(cost(finalCents, f))}`} onClick={() => choose(text(f))}>
        <span className="cop-e-dot" />
        <span className="cop-e-word">{word}{d > 1 && <em><Frac d={d} /></em>}</span>
        {available ? <span className="cop-e-price">{money(cost(finalCents, f))}</span> : <span className="cop-e-why">Only {text(room)} left</span>}
      </button>;
    })}
    <button type="button" role="radio" className="cop-e-row" aria-checked={customOpen || customSelected} disabled={busy || room.n <= 0n} aria-label="Custom" onClick={openCustom}>
      <span className="cop-e-dot" />
      <span className="cop-e-word">Custom amount{custom && <em>{customValue}</em>}</span>
      <span className="cop-e-price">{custom ? money(cost(finalCents, custom)) : "›"}</span>
    </button>
  </div>;
}

// PROTOTYPE — throwaway. In-memory fixture and state for the claim re-review prototype.
// Question: what should per-item re-review, over-allocation and live changes look like
// on the item-claims page? No backend, no persistence.
import type { BillItem } from "../receipt-api";
import { fraction, one, subtract, text, shortText, parse, lessOrEqual, share } from "../claim-fractions";

export type Fraction = { n: bigint; d: bigint };
export const zero: Fraction = fraction(0n, 1n);
export const plus = (a: Fraction, b: Fraction) => subtract(a, fraction(-b.n, b.d));
export const greater = (a: Fraction, b: Fraction) => !lessOrEqual(a, b);
export const halfOf = (f: Fraction) => fraction(f.n, f.d * 2n);
export const percent = (f: Fraction) => Number((f.n * 1000000n) / f.d) / 10000;
export { one, text, shortText, parse };

export type Other = "B" | "C" | "D";
export type PersonId = "A" | Other;
export const people: Record<PersonId, { name: string; tint: string }> = {
  A: { name: "You", tint: "var(--action)" },
  B: { name: "Ben", tint: "var(--avatar-2)" },
  C: { name: "Chloe", tint: "var(--avatar-3)" },
  D: { name: "Dev", tint: "var(--avatar-5)" },
};
export const otherIds: Other[] = ["B", "C", "D"];
export const initiatorName = people.D.name;

export type Item = {
  id: string; name: string; quantity: string; originalText: string; finalCents: number;
  altName: string; claims: Partial<Record<Other, string>>;
};
/** What A last looked at for an item; a difference means the initiator changed it since. */
export type Seen = { name: string; finalCents: number };
export type Removed = { id: string; name: string; finalCents: number; portion: string; index: number };
export type Flash = { person: Other; at: number; delta: string };
export type State = {
  items: Item[];
  saved: Record<string, string>;
  draft: Record<string, string>;
  seen: Record<string, Seen>;
  removed: Removed[];
  flash: Record<string, Flash>;
  conflict: { itemId: string } | null;
  log: { at: number; text: string }[];
  savedAt: number | null;
  nextAdd: number;
};

const fixtureItems: Item[] = [
  { id: "bananas", name: "Organic bananas", quantity: "1", originalText: "ORG BANANAS 1.13KG", finalCents: 249, altName: "Organic bananas, 1.1 kg", claims: { B: "1/2" } },
  { id: "oatmilk", name: "Oat milk 1.75 L", quantity: "2", originalText: "OATLY OAT 1.75L 2@4.49", finalCents: 898, altName: "Oatly oat milk 1.75 L", claims: { C: "1/2", D: "1/4" } },
  { id: "sourdough", name: "Sourdough loaf", quantity: "1", originalText: "PC SOURDOUGH 675G", finalCents: 599, altName: "PC sourdough loaf", claims: { B: "1/3", C: "1/3" } },
  { id: "eggs", name: "Free-range eggs, dozen", quantity: "1", originalText: "BURNBRAE FR EGGS 12", finalCents: 649, altName: "Burnbrae free-range eggs", claims: { D: "1/2" } },
  { id: "fish", name: "Atlantic salmon fillet", quantity: "1", originalText: "ATL SALMON FLT 0.62KG", finalCents: 1437, altName: "Salmon fillet, 620 g", claims: { B: "1/4", C: "1/4" } },
  { id: "spinach", name: "Baby spinach 312 g", quantity: "1", originalText: "EARTHBOUND SPINACH", finalCents: 499, altName: "Earthbound baby spinach", claims: {} },
  { id: "cheddar", name: "Aged cheddar 400 g", quantity: "1", originalText: "BALDERSON 2YR CHED", finalCents: 749, altName: "Balderson 2-year cheddar", claims: { C: "1" } },
];
const addPool: Omit<Item, "claims">[] = [
  { id: "syrup", name: "Maple syrup 540 mL", quantity: "1", originalText: "MAPLE SYRUP AMBER 540ML", finalCents: 1199, altName: "Amber maple syrup" },
  { id: "yogurt", name: "Greek yogurt 750 g", quantity: "1", originalText: "OIKOS GRK YOG 750G", finalCents: 649, altName: "Oikos Greek yogurt" },
  { id: "berries", name: "Blueberries 510 g", quantity: "1", originalText: "BLUEBERRIES 510G", finalCents: 599, altName: "Wild blueberries" },
];

export function initialState(): State {
  const items = fixtureItems.map((item) => ({ ...item, claims: { ...item.claims } }));
  return {
    items,
    saved: { oatmilk: "1/4", eggs: "1/2" },
    draft: { oatmilk: "1/4", eggs: "1/2", bananas: "1/4", fish: "1/3" },
    seen: Object.fromEntries(items.map((item) => [item.id, { name: item.name, finalCents: item.finalCents }])),
    removed: [], flash: {}, conflict: null, savedAt: null, nextAdd: 0,
    log: [{ at: Date.now(), text: "Loaded: you have 2 confirmed claims and 2 unsaved picks." }],
  };
}

// ---- Derived facts ----
export const claimOf = (value: string | undefined) => (value ? parse(value) ?? zero : zero);
export function othersOf(item: Item) {
  return otherIds.flatMap((person) => {
    const f = claimOf(item.claims[person]);
    return f.n > 0n ? [{ person, f }] : [];
  });
}
export const othersTotal = (item: Item) => othersOf(item).reduce((a, o) => plus(a, o.f), zero);
export const room = (item: Item) => subtract(one, othersTotal(item));
export const mineOf = (state: State, id: string) => parse(state.draft[id] ?? "");
export const isSelected = (state: State, id: string) => !!state.draft[id] || !!state.saved[id];
export const freeAfterMine = (state: State, item: Item) => {
  const f = subtract(room(item), mineOf(state, item.id) ?? zero);
  return f.n > 0n ? f : zero;
};

export type ItemAttention = {
  isNew: boolean;
  changed: { from: Seen; to: Seen } | null;
  /** A price/name change on an item A never selected: shown quietly, never blocks. */
  quiet: { from: Seen; to: Seen } | null;
  over: { left: Fraction; by: Fraction; conflict: boolean } | null;
};
export function attentionOf(state: State, item: Item): ItemAttention {
  const seen = state.seen[item.id];
  const differs = !!seen && (seen.name !== item.name || seen.finalCents !== item.finalCents);
  const change = differs ? { from: seen, to: { name: item.name, finalCents: item.finalCents } } : null;
  const selected = isSelected(state, item.id);
  const mine = mineOf(state, item.id);
  const left = room(item);
  const over = mine && greater(mine, left) ? { left, by: subtract(mine, left), conflict: state.conflict?.itemId === item.id } : null;
  return { isNew: !seen, changed: selected ? change : null, quiet: selected ? null : change, over };
}
export const needsReview = (a: ItemAttention) => a.isNew || !!a.changed;
export const blocking = (a: ItemAttention) => needsReview(a) || !!a.over;

export type Blocker =
  | { kind: "removed"; removed: Removed }
  | { kind: "item"; item: Item; attention: ItemAttention };
export function blockersOf(state: State): Blocker[] {
  const list: Blocker[] = state.items.flatMap((item) => {
    const attention = attentionOf(state, item);
    return blocking(attention) ? [{ kind: "item" as const, item, attention }] : [];
  });
  return [...state.removed.map((removed) => ({ kind: "removed" as const, removed })), ...list];
}
export function counts(state: State) {
  const blockers = blockersOf(state);
  const review = blockers.filter((b) => b.kind === "removed" || needsReview(b.attention)).length;
  const over = blockers.filter((b) => b.kind === "item" && b.attention.over).length;
  return { blockers, review, over, total: blockers.length };
}
export const yourShare = (state: State) => share(state.items as unknown as BillItem[], state.draft);
export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// ---- Actions ----
export type Action =
  | { type: "choose"; id: string; value: string }
  | { type: "ack"; id: string }
  | { type: "open"; id: string }
  | { type: "dismissRemoved"; id: string }
  | { type: "confirm" }
  | { type: "reset" }
  | { type: "sim"; sim: Sim; target: string };
export type Sim = "benMore" | "chloeRelease" | "price" | "rename" | "taxShift" | "add" | "removeSelected" | "removeOther" | "benRest" | "conflict";

function log(state: State, textLine: string): State {
  return { ...state, log: [{ at: Date.now(), text: textLine }, ...state.log].slice(0, 12) };
}
function setClaim(item: Item, person: Other, f: Fraction): Item {
  const claims = { ...item.claims };
  if (f.n > 0n) claims[person] = text(f); else delete claims[person];
  return { ...item, claims };
}
function replaceItem(state: State, item: Item): State {
  return { ...state, items: state.items.map((i) => (i.id === item.id ? item : i)) };
}
function flash(state: State, id: string, person: Other, delta: string): State {
  return { ...state, flash: { ...state.flash, [id]: { person, at: Date.now(), delta } } };
}
const seenNow = (item: Item): Seen => ({ name: item.name, finalCents: item.finalCents });

export function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "choose": {
      const item = state.items.find((i) => i.id === action.id);
      if (!item) return state;
      const draft = { ...state.draft };
      if (action.value) draft[action.id] = action.value; else delete draft[action.id];
      const conflict = state.conflict?.itemId === action.id ? null : state.conflict;
      return { ...state, draft, conflict, seen: { ...state.seen, [item.id]: seenNow(item) } };
    }
    case "ack":
    case "open": {
      const item = state.items.find((i) => i.id === action.id);
      if (!item) return state;
      const a = attentionOf(state, item);
      // Opening acknowledges a new item and any quiet change; a change to A's own pick needs the explicit button.
      if (action.type === "open" && !a.isNew && !a.quiet) return state;
      return { ...state, seen: { ...state.seen, [item.id]: seenNow(item) } };
    }
    case "dismissRemoved":
      return { ...state, removed: state.removed.filter((r) => r.id !== action.id) };
    case "confirm": {
      if (blockersOf(state).length) return state;
      const next = { ...state, saved: { ...state.draft }, conflict: null, savedAt: Date.now() };
      return log(next, `You confirmed ${plural(Object.keys(state.draft).length, "claim", "claims")}.`);
    }
    case "reset":
      return initialState();
    case "sim":
      return simulate(state, action.sim, action.target);
  }
}

function pickItem(state: State, target: string, fits: (item: Item) => boolean) {
  const preferred = state.items.find((i) => i.id === target);
  return preferred && fits(preferred) ? preferred : state.items.find(fits);
}

function simulate(state: State, sim: Sim, target: string): State {
  switch (sim) {
    case "benMore": {
      const item = pickItem(state, target, (i) => freeAfterMine(state, i).n > 0n);
      if (!item) return log(state, "Ben can't take more: nothing is free anywhere.");
      const free = freeAfterMine(state, item);
      const sixth = fraction(1n, 6n);
      const step = lessOrEqual(sixth, free) ? sixth : free;
      const next = setClaim(item, "B", plus(claimOf(item.claims.B), step));
      return log(flash(replaceItem(state, next), item.id, "B", `+${text(step)}`), `Ben saved ${text(claimOf(next.claims.B))} of ${item.name} (+${text(step)}).`);
    }
    case "chloeRelease": {
      const item = pickItem(state, target, (i) => !!i.claims.C);
      if (!item) return log(state, "Chloe has no claims left to release.");
      const released = claimOf(item.claims.C);
      return log(flash(replaceItem(state, setClaim(item, "C", zero)), item.id, "C", `−${text(released)}`), `Chloe released her ${text(released)} of ${item.name}.`);
    }
    case "price": {
      const item = state.items.find((i) => i.id === target) ?? state.items[0];
      const finalCents = Math.round(item.finalCents * 1.25);
      return log(replaceItem(state, { ...item, finalCents }), `${initiatorName} changed ${item.name}'s price.`);
    }
    case "rename": {
      const item = state.items.find((i) => i.id === target) ?? state.items[0];
      return log(replaceItem(state, { ...item, name: item.altName, altName: item.name }), `${initiatorName} renamed ${item.name} to ${item.altName}.`);
    }
    case "taxShift": {
      // Correcting the receipt's tax re-allocates it: every item's final cost moves a little.
      const items = state.items.map((i) => ({ ...i, finalCents: Math.round(i.finalCents * 1.04) }));
      return log({ ...state, items }, `${initiatorName} corrected the receipt tax; every item's final cost changed.`);
    }
    case "add": {
      const template = addPool[state.nextAdd % addPool.length];
      const round = Math.floor(state.nextAdd / addPool.length);
      const item: Item = { ...template, id: `${template.id}${round || ""}`, claims: {} };
      return log({ ...state, items: [...state.items, item], nextAdd: state.nextAdd + 1 }, `${initiatorName} added ${item.name}.`);
    }
    case "removeSelected":
    case "removeOther": {
      const wantSelected = sim === "removeSelected";
      const item = pickItem(state, target, (i) => isSelected(state, i.id) === wantSelected);
      if (!item) return log(state, wantSelected ? "You have no selected items to remove." : "Every item is selected by you.");
      const index = state.items.indexOf(item);
      const draft = { ...state.draft }; delete draft[item.id];
      const saved = { ...state.saved }; delete saved[item.id];
      const next = { ...state, items: state.items.filter((i) => i !== item), draft, saved,
        conflict: state.conflict?.itemId === item.id ? null : state.conflict };
      if (!wantSelected) return log(next, `${initiatorName} removed ${item.name} (you hadn't picked it).`);
      const portion = state.draft[item.id] || state.saved[item.id];
      return log({ ...next, removed: [...state.removed, { id: item.id, name: item.name, finalCents: item.finalCents, portion, index }] },
        `${initiatorName} removed ${item.name}; your ${portion} was dropped.`);
    }
    case "benRest":
    case "conflict": {
      const item = pickItem(state, target, (i) => !!mineOf(state, i.id) && !attentionOf(state, i).over);
      if (!item) return log(state, "Pick a portion of an item first, so someone can take it from you.");
      const mine = mineOf(state, item.id)!;
      // Take whatever is free plus half of A's pick, leaving A a smaller remainder.
      const taken = plus(freeAfterMine(state, item), halfOf(mine));
      if (sim === "benRest") {
        const next = setClaim(item, "B", plus(claimOf(item.claims.B), taken));
        return log(flash(replaceItem(state, next), item.id, "B", `+${text(taken)}`), `Ben saved ${text(claimOf(next.claims.B))} of ${item.name}; your pick no longer fits.`);
      }
      // A race: Dev's save lands just before A's Confirm, so A only learns about it from the failed save.
      const next = setClaim(item, "D", plus(claimOf(item.claims.D), taken));
      return log({ ...replaceItem(state, next), conflict: { itemId: item.id }, savedAt: null },
        `Your Confirm failed: Dev saved ${text(taken)} more of ${item.name} a moment earlier.`);
    }
  }
}

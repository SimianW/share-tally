// PROTOTYPE for #150 — throwaway, do not ship.
// Plan: three variants of the By amount share picker, switchable via ?variant=A|B|C.
// Stub scenario data: no network, no Clerk. Everything is derived from the Scenario panel.
import type { Bill } from "../bill-api";
import type { BillItem } from "../receipt-api";
import { cost, fraction } from "../claim-fractions";
import { palettes, type PaletteKey } from "../palettes";
import type { Person } from "./amount-portion";

export type View = "draft" | "participant" | "items";
export type Scheme = "light" | "dark";
export type Scenario = {
  view: View;
  n: number;
  /** Total paid in cents as a string; "" is empty (draft only). */
  total: "10000" | "8743" | "1000" | "";
  others: "none" | "some" | "all";
  /** Others' submitted amounts leave too little room, so an Even pick goes over. */
  over: boolean;
  /** The participant already saved an amount (Even at the time). */
  saved: boolean;
  reopened: boolean;
  terminal: boolean;
  scheme: Scheme;
  palette: PaletteKey;
};

export const people: Person[] = ["Simon", "Alice", "Bob", "Chen", "Dana", "Eli", "Fay", "Gus"]
  .map((name) => ({ id: name.toLowerCase(), displayName: name }));

const pick = <T extends string>(value: string | null, allowed: readonly T[], fallback: T): T =>
  allowed.includes(value as T) ? (value as T) : fallback;

export function readScenario(params: URLSearchParams, scheme: Scheme, palette: PaletteKey): Scenario {
  const n = Number(params.get("n"));
  return {
    view: pick(params.get("view"), ["draft", "participant", "items"], "participant"),
    n: Number.isInteger(n) && n >= 1 && n <= 8 ? n : 3,
    total: params.has("total") ? pick(params.get("total"), ["10000", "8743", "1000", ""], "10000") : "10000",
    others: pick(params.get("others"), ["none", "some", "all"], "some"),
    over: params.get("over") === "1",
    saved: params.get("saved") === "1",
    reopened: params.get("reopened") === "1",
    terminal: params.get("terminal") === "1",
    scheme: pick(params.get("scheme"), ["light", "dark"], scheme),
    palette: pick(params.get("palette"), palettes.map((p) => p.key), palette),
  };
}

export function writeScenario(scenario: Scenario, variant: string) {
  const params = new URLSearchParams({
    variant, view: scenario.view, n: String(scenario.n), total: scenario.total, others: scenario.others,
    scheme: scenario.scheme, palette: scenario.palette,
  });
  for (const flag of ["over", "saved", "reopened", "terminal"] as const) if (scenario[flag]) params.set(flag, "1");
  return `?${params}`;
}

/** The parts of a scenario that reset the prototype's local state when they change. */
export const scenarioKey = (s: Scenario) => [s.view, s.n, s.total, s.others, s.over, s.saved, s.reopened, s.terminal].join("|");

const stamp = "2026-09-28T18:00:00.000Z";

/** The draft's total; the empty choice only exists there. */
export const draftTotal = (s: Scenario) => (s.total ? Number(s.total) : null);

/**
 * A By amount bill for the participant view. Simon is the viewer; Alice paid (unless alone).
 * Reopened: Alice raised the total from $100.00 to $120.00 after people saved, which clears
 * confirmations but keeps every amount, including Simon's $33.33.
 */
export function participantBill(s: Scenario): { bill: Bill; oldTotalCents: number | null } {
  const members = people.slice(0, s.n);
  const others = members.slice(1);
  const totalCents = s.reopened ? 12000 : Number(s.total || "10000");
  // Amounts saved before a reopening were against the old total.
  const basis = s.reopened ? 10000 : totalCents;
  const even = cost(basis, fraction(1n, BigInt(s.n)));
  const submittedCount = s.terminal || s.over ? others.length
    : s.others === "all" ? others.length : s.others === "some" ? Math.ceil(others.length / 2) : 0;
  // Over: everyone else together already holds 90% of the total.
  const othersShare = s.over && !s.terminal ? Math.round((basis * 0.9) / Math.max(1, others.length)) : even;
  const othersCents = others.map((_, index) => index < submittedCount ? othersShare : null);
  const othersSum = othersCents.reduce<number>((sum, cents) => sum + (cents ?? 0), 0);
  const ownCents = s.terminal ? Math.max(0, totalCents - othersSum)
    : s.reopened ? 3333
      : s.over ? (others.length ? even : totalCents + 500)
        : s.saved ? even : null;
  const ownConfirmed = s.terminal || (!s.reopened && !s.over && s.saved);
  const participants: Bill["participants"] = members.map((person, index) => {
    const amountCents = index === 0 ? ownCents : othersCents[index - 1];
    const confirmed = index === 0 ? ownConfirmed : s.terminal || (!s.reopened && amountCents !== null);
    return {
      userId: person.id, displayName: person.displayName, isCurrentUser: index === 0,
      amountCents, confirmedAt: confirmed ? stamp : null,
    };
  });
  const submittedCents = participants.reduce((sum, p) => sum + (p.amountCents ?? 0), 0);
  const bill: Bill = {
    mode: "manual", id: "proto-bill", groupId: "proto-group",
    initiatorId: members.length > 1 ? members[1].id : members[0].id,
    title: "Costco run · Sep 28", purchaseDate: "2026-09-28", notes: "",
    totalCents, submittedCents, differenceCents: totalCents - submittedCents,
    confirmedCount: participants.filter((p) => p.confirmedAt).length,
    adjustmentCents: s.terminal ? totalCents - submittedCents : null,
    completedAt: s.terminal ? stamp : null, canceledAt: null, revision: 4, participants,
  };
  return { bill, oldTotalCents: s.reopened ? 10000 : null };
}

/** The By item reference: Kirkland Olive Oil, Alice holding 1/3 (or 3/4 when Over is on). */
export function referenceItem(s: Scenario): { item: BillItem; participants: Bill["participants"] } {
  const members = people.slice(0, Math.max(2, s.n));
  const participants: Bill["participants"] = members.map((person, index) => ({
    userId: person.id, displayName: person.displayName, isCurrentUser: index === 0, amountCents: null, confirmedAt: null,
  }));
  const [numerator, denominator] = s.over ? [3, 4] : [1, 3];
  const item: BillItem = {
    id: "olive-oil", name: "Kirkland Olive Oil 2L", originalText: "KS OLIVE OIL 2L", quantity: "1",
    amountCents: 2499, discountCents: 0, finalCents: 2499, version: 1, taxCents: 0, extraCents: 0,
    claims: [{ itemId: "olive-oil", userId: "alice", numerator, denominator, confirmedAt: stamp }],
  };
  return { item, participants };
}

// Copied from BillDetails so the page shows the same correction notice.
export function needsAmountCorrection(bill: Bill) {
  const initiator = bill.participants.find((p) => p.userId === bill.initiatorId)!;
  const adjustmentWouldBeNegative = initiator.amountCents !== null && initiator.amountCents + bill.differenceCents < 0;
  return bill.mode !== "items" && !bill.completedAt && !bill.canceledAt &&
    ((Math.abs(bill.differenceCents) > 5 &&
      (bill.differenceCents < 0 || bill.participants.every((p) => p.amountCents !== null))) ||
      (adjustmentWouldBeNegative && bill.confirmedCount === bill.participants.length));
}

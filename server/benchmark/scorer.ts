// Offline receipt benchmark. Money is integer minor units and rates/quantities are decimal strings.
// Only explicitly supported fields are scored; a missing recorded value is not an unsupported field.
export const SCORED_FIELDS = [
  "merchant", "currency", "items.count", "items.missing", "items.extra",
  "items.description", "items.azureDescription", "items.productCode", "items.quantity", "items.unit",
  "items.unitPrice", "items.linePrice", "items.ownDiscount",
  "receiptDiscounts", "subtotal", "taxLines", "taxTotal", "taxMode",
  "charges", "rounding", "total", "taxability",
  "taxLines.count", "taxLines.missing", "taxLines.extra", "taxLines.label", "taxLines.amount", "taxLines.rate",
  "receiptDiscounts.count", "receiptDiscounts.missing", "receiptDiscounts.extra", "receiptDiscounts.label", "receiptDiscounts.amount",
  "charges.count", "charges.missing", "charges.extra", "charges.label", "charges.amount", "charges.stage",
] as const;
export type ScoredField = (typeof SCORED_FIELDS)[number];
export type SupportedField = Exclude<ScoredField, "items.count" | "items.missing" | "items.extra"> | "items";

/** Canonical runtime vocabulary, derived from the same fields as the TypeScript contract. */
export const SUPPORTED_FIELDS: readonly SupportedField[] = [
  "items", ...SCORED_FIELDS.filter((field): field is Exclude<ScoredField, "items.count" | "items.missing" | "items.extra"> =>
    field !== "items.count" && field !== "items.missing" && field !== "items.extra"),
];

type Maybe<T> = T | null;
export interface ReceiptItemLabel {
  id?: string;
  description?: Maybe<string>;
  productCode?: Maybe<string>;
  quantity?: Maybe<string>;
  unit?: Maybe<string>;
  unitPrice?: Maybe<number>;
  linePrice?: Maybe<number>;
  ownDiscount?: Maybe<number>;
}
export interface ReceiptItemPrediction extends Omit<ReceiptItemLabel, "id"> {
  /** Original raw Azure Items index, preserved through filtering/reordering; null for new rows. */
  sourceIndex?: number | null;
  /** Runner-owned raw Azure Description projection, never a pipeline display name. */
  azureDescription?: Maybe<string>;
  taxable?: Maybe<boolean>;
}
export interface DiscountLabel { label?: Maybe<string>; amount?: Maybe<number> }
export interface TaxLineLabel { label?: Maybe<string>; rate?: Maybe<string>; amount?: Maybe<number> }
export interface ChargeLabel { label?: Maybe<string>; amount?: Maybe<number>; stage?: Maybe<string> }
export interface ReceiptLabel {
  id?: string;
  merchant?: Maybe<string>;
  currency?: Maybe<string>;
  items?: Maybe<ReceiptItemLabel[]>;
  receiptDiscounts?: Maybe<DiscountLabel[]>;
  subtotal?: Maybe<number>;
  subtotalBasis?: Maybe<string>;
  taxLines?: Maybe<TaxLineLabel[]>;
  taxTotal?: Maybe<number>;
  taxMode?: Maybe<string>;
  charges?: Maybe<ChargeLabel[]>;
  rounding?: Maybe<number>;
  total?: Maybe<number>;
  taxability?: Maybe<Array<{ itemId: string; taxable: Maybe<boolean> }>>;
}
export interface BenchmarkPrediction {
  /** Canonical paths from SupportedField. "items" declares the item list/count only. */
  supportedFields: readonly SupportedField[];
  merchant?: Maybe<string>;
  currency?: Maybe<string>;
  items?: Maybe<ReceiptItemPrediction[]>;
  receiptDiscounts?: Maybe<DiscountLabel[]>;
  subtotal?: Maybe<number>;
  taxLines?: Maybe<TaxLineLabel[]>;
  taxTotal?: Maybe<number>;
  taxMode?: Maybe<string>;
  charges?: Maybe<ChargeLabel[]>;
  rounding?: Maybe<number>;
  total?: Maybe<number>;
  /** Indexed like predicted items. Alternatively each predicted item may carry taxable. */
  taxability?: Maybe<Array<Maybe<boolean>>>;
}
export interface FieldScore {
  correct: number;
  scored: number;
  unprinted: number;
  unsupported: number;
  missingRecording: number;
}
export interface ScoreResult {
  fields: Record<ScoredField, FieldScore>;
  matching: { matched: number; missing: number; extra: number };
  correct: number;
  scored: number;
  unprinted: number;
  unsupported: number;
  missingRecording: number;
  /** Source receipt ids, if available; aggregation does not use them as matching keys. */
  receiptIds: string[];
  /** Individual results retained for the per-receipt gate; populated by aggregateScores. */
  receipts: ScoreResult[];
}
export interface GateRegression {
  field: ScoredField;
  baseline: number | null;
  candidate: number | null;
  reason: "accuracy" | "lost-support" | "missing-recording";
  receiptIndex?: number;
  receiptId?: string;
}
export interface GateResult {
  status: "pass" | "regression" | "incomplete";
  regressions: GateRegression[];
  receiptRegressions: GateRegression[];
  incompleteFields: ScoredField[];
}

const ITEM_FIELDS = ["description", "productCode", "quantity", "unit", "unitPrice", "linePrice", "ownDiscount"] as const;
type ItemField = (typeof ITEM_FIELDS)[number];
const COLLECTIONS = ["receiptDiscounts", "taxLines", "charges"] as const;
const defined = (value: unknown): boolean => value !== null && value !== undefined;

function emptyField(): FieldScore {
  return { correct: 0, scored: 0, unprinted: 0, unsupported: 0, missingRecording: 0 };
}
function emptyResult(): ScoreResult {
  return {
    fields: Object.fromEntries(SCORED_FIELDS.map((field) => [field, emptyField()])) as Record<ScoredField, FieldScore>,
    correct: 0, scored: 0, unprinted: 0, unsupported: 0, missingRecording: 0,
    matching: { matched: 0, missing: 0, extra: 0 },
    receiptIds: [], receipts: [],
  };
}
function supported(prediction: BenchmarkPrediction | null, field: ScoredField): boolean {
  // A missing entire recording is handled separately from an unsupported field.
  if (!prediction) return true;
  if (field.startsWith("items.") && ["items.count", "items.missing", "items.extra"].includes(field)) {
    return prediction.supportedFields.includes("items") || prediction.supportedFields.some((f) => f.startsWith("items."));
  }
  const parent = COLLECTIONS.find((collection) => field.startsWith(`${collection}.`));
  return prediction.supportedFields.includes(field as SupportedField) ||
    (parent !== undefined && prediction.supportedFields.includes(parent));
}
function record(result: ScoreResult, field: ScoredField, groundTruth: unknown, actual: unknown, isSupported: boolean, same = Object.is): void {
  const score = result.fields[field];
  if (!defined(groundTruth)) { score.unprinted++; return; }
  if (!isSupported) { score.unsupported++; return; }
  score.scored++;
  // A returned null is an incorrect extraction, not a missing replay/recording.
  if (!defined(actual)) return;
  if (same(groundTruth, actual)) score.correct++;
}
function normalizedText(text: string): string {
  return text.normalize("NFKC").toLocaleLowerCase("en").replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
}
function valueEqual(field: ScoredField, a: unknown, b: unknown): boolean {
  if (typeof a === "string" && typeof b === "string") {
    if (field === "items.description" || field === "items.azureDescription" || field === "merchant") return normalizedText(a) === normalizedText(b);
    // Decimal strings are normalized without using floating point.
    if (field === "items.quantity" || field === "taxLines.rate") return decimalEqual(a, b);
    return a.trim().toLowerCase() === b.trim().toLowerCase();
  }
  return Object.is(a, b);
}
function decimalEqual(a: string, b: string): boolean {
  const canonical = (s: string) => {
    if (!/^[+-]?\d+(?:\.\d+)?$/.test(s.trim())) return s.trim();
    const [whole, fraction = ""] = s.trim().replace(/^\+/, "").split(".");
    const sign = whole!.startsWith("-") ? "-" : "";
    const integer = whole!.replace(/^[+-]/, "").replace(/^0+(?=\d)/, "");
    const tail = fraction.replace(/0+$/, "");
    return `${integer === "0" && !tail ? "" : sign}${integer}${tail ? `.${tail}` : ""}`;
  };
  return canonical(a) === canonical(b);
}

// Match by printed content, never by generated IDs or position. Dummy columns leave weak matches
// unmatched. A global assignment avoids shifting every subsequent row after an insertion.
function affinity(a: ReceiptItemLabel, b: ReceiptItemPrediction): number {
  let score = 0;
  const matchingDescription = b.azureDescription ?? b.description;
  let textEvidence = false;
  if (defined(a.productCode) && defined(b.productCode) && valueEqual("items.productCode", a.productCode, b.productCode)) {
    score += 9;
    textEvidence = true;
  }
  if (defined(a.description) && defined(matchingDescription)) {
    const left = normalizedText(a.description!);
    const right = normalizedText(matchingDescription!);
    if (left && left === right) { score += 7; textEvidence = true; }
    else if (left && right) {
      const x = new Set(left.split(" "));
      const y = new Set(right.split(" "));
      const shared = [...x].filter((word) => y.has(word)).length;
      if (shared) textEvidence = true;
      score += 5 * shared / (x.size + y.size - shared);
    }
  }
  // Equal prices alone are common on unrelated receipt rows.
  if (!textEvidence && defined(a.description) && defined(matchingDescription)) return 0;
  if (defined(a.linePrice) && defined(b.linePrice) && a.linePrice === b.linePrice) score += 4;
  if (defined(a.quantity) && defined(b.quantity) && decimalEqual(a.quantity!, b.quantity!)) score += 0.5;
  return score;
}
function alignItems(label: ReceiptItemLabel[], predicted: ReceiptItemPrediction[]): Array<number | null> {
  return alignRows(label.length, predicted.length, (i, j) => affinity(label[i]!, predicted[j]!), 3);
}
/** One shared assignment for all attributes, never a fresh pairing for each field. */
function alignRows(n: number, predictedCount: number, strengthAt: (i: number, j: number) => number, minimum: number): Array<number | null> {
  const m = predictedCount + n;
  if (!n) return [];
  // Rectangular Hungarian minimum-cost assignment. Ties follow input order deterministically.
  const costs = Array.from({ length: n }, (_, i) => Array.from({ length: m }, (_, j) => {
    const strength = j < predictedCount ? strengthAt(i, j) : 0;
    // On equivalent printed rows, prefer minimum displacement then source order.
    return strength >= minimum ? 10000 - Math.round(strength * 100) + Math.abs(i - j) * 0.001 : 10000;
  }));
  const u = Array<number>(n + 1).fill(0);
  const v = Array<number>(m + 1).fill(0);
  const p = Array<number>(m + 1).fill(0);
  const way = Array<number>(m + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = Array<number>(m + 1).fill(Infinity);
    const used = Array<boolean>(m + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0]!;
      let delta = Infinity;
      let j1 = 0;
      for (let j = 1; j <= m; j++) {
        if (used[j]) continue;
        const cur = costs[i0 - 1]![j - 1]! - u[i0]! - v[j]!;
        if (cur < minv[j]!) { minv[j] = cur; way[j] = j0; }
        if (minv[j]! < delta) { delta = minv[j]!; j1 = j; }
      }
      for (let j = 0; j <= m; j++) {
        if (used[j]) { u[p[j]!] += delta; v[j] -= delta; }
        else minv[j] -= delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do { const j1 = way[j0]!; p[j0] = p[j1]!; j0 = j1; } while (j0 !== 0);
  }
  const assignment: Array<number | null> = Array(n).fill(null);
  for (let j = 1; j <= m; j++) {
    if (!p[j]) continue;
    const i = p[j]! - 1;
    if (j <= predictedCount && costs[i]![j - 1]! < 10000) assignment[i] = j - 1;
  }
  return assignment;
}

function collectionEqual(a: unknown, b: unknown): boolean {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  // Match unordered entries one-to-one. Null/absent GT attributes are unknown, not
  // requirements to predict null; duplicate printed entries must each find a partner.
  const equivalent = (expected: Record<string, unknown>, actual: Record<string, unknown>) =>
    ["label", "rate", "amount", "stage"].every((key) => !defined(expected[key]) ||
      (typeof expected[key] === "string" && typeof actual[key] === "string"
        ? key === "rate" ? decimalEqual(expected[key], actual[key]) : expected[key].trim().toLowerCase() === actual[key].trim().toLowerCase()
        : Object.is(expected[key], actual[key])));
  const candidates = a.map((entry: Record<string, unknown>) => b.flatMap((other: Record<string, unknown>, i: number) => equivalent(entry, other) ? [i] : []));
  const owner = Array<number>(b.length).fill(-1);
  const visit = (row: number, seen: Set<number>): boolean => {
    for (const column of candidates[row]!) {
      if (seen.has(column)) continue;
      seen.add(column);
      if (owner[column] === -1 || visit(owner[column]!, seen)) { owner[column] = row; return true; }
    }
    return false;
  };
  return a.every((_: unknown, row: number) => visit(row, new Set()));
}

const COLLECTION_ATTRIBUTES = {
  taxLines: ["label", "amount", "rate"],
  receiptDiscounts: ["label", "amount"],
  charges: ["label", "amount", "stage"],
} as const;
type CollectionRow = { label?: Maybe<string>; amount?: Maybe<number>; rate?: Maybe<string>; stage?: Maybe<string> };
function scoreCollection(result: ScoreResult, collection: typeof COLLECTIONS[number], expected: CollectionRow[] | null | undefined, actual: CollectionRow[] | null | undefined, prediction: BenchmarkPrediction | null) {
  const attributes = COLLECTION_ATTRIBUTES[collection];
  const field = (attribute: string) => `${collection}.${attribute}` as ScoredField;
  const alignment = expected && actual ? alignRows(expected.length, actual.length, (i, j) => {
    // A wrong label must not erase an independently correct amount. Prefer exact
    // labels, then amount/rate/stage, and pair remaining rows deterministically.
    let strength = 1;
    for (const attribute of attributes) {
      if (defined(expected[i]![attribute]) && defined(actual[j]![attribute]) && valueEqual(field(attribute), expected[i]![attribute], actual[j]![attribute])) {
        strength += attribute === "label" ? 8 : attribute === "amount" ? 4 : 2;
      }
    }
    return strength;
  }, 1) : expected?.map(() => null) ?? [];
  const used = new Set(alignment.filter((index): index is number => index !== null));
  record(result, field("count"), expected?.length, actual?.length, supported(prediction, field("count")));
  record(result, field("missing"), expected ? 0 : null, actual ? (expected?.length ?? 0) - used.size : undefined, supported(prediction, field("missing")));
  record(result, field("extra"), expected ? 0 : null, actual ? actual.length - used.size : undefined, supported(prediction, field("extra")));
  if (!expected) {
    for (const attribute of attributes) result.fields[field(attribute)].unprinted++;
    return;
  }
  expected.forEach((row, i) => {
    const index = alignment[i];
    const observed = index === null ? undefined : actual?.[index!];
    for (const attribute of attributes) record(result, field(attribute), row[attribute], observed?.[attribute], supported(prediction, field(attribute)), (a, b) => valueEqual(field(attribute), a, b));
  });
  actual?.forEach((row, i) => {
    if (used.has(i)) return;
    for (const attribute of attributes) if (defined(row[attribute]) && supported(prediction, field(attribute))) result.fields[field(attribute)].scored++;
  });
}

export function scoreReceipt(label: ReceiptLabel, prediction: BenchmarkPrediction | null): ScoreResult {
  const result = emptyResult();
  if (label.id) result.receiptIds.push(label.id);
  for (const field of ["merchant", "currency", "taxTotal", "taxMode", "rounding", "total"] as const) {
    record(result, field, label[field], prediction?.[field], supported(prediction, field), (a, b) => valueEqual(field, a, b));
  }
  // A derived subtotal is useful for reconciliation, but is NOT a printed subtotal prediction.
  record(result, "subtotal", label.subtotalBasis === "derived-items" ? null : label.subtotal,
    prediction?.subtotal, supported(prediction, "subtotal"));
  for (const field of COLLECTIONS) {
    record(result, field, label[field], prediction?.[field], supported(prediction, field), collectionEqual);
    scoreCollection(result, field, label[field], prediction?.[field], prediction);
  }
  const items = label.items;
  const predicted = prediction?.items;
  const itemSupport = supported(prediction, "items.count");
  record(result, "items.count", items?.length, predicted?.length, itemSupport);
  const alignment = items && Array.isArray(predicted) ? alignItems(items, predicted) : items?.map(() => null) ?? [];
  const used = new Set(alignment.filter((index): index is number => index !== null));
  if (items) {
    record(result, "items.missing", 0, Array.isArray(predicted) ? alignment.filter((index) => index === null).length : undefined, itemSupport);
    record(result, "items.extra", 0, Array.isArray(predicted) ? predicted.length - used.size : undefined, itemSupport);
    items.forEach((item, i) => {
      const match = alignment[i];
      const observed = match === null ? undefined : predicted?.[match];
      for (const property of ITEM_FIELDS) {
        const field = `items.${property}` as ScoredField;
        // Missing aligned items are errors, not absent recordings of an otherwise present item.
        record(result, field, item[property], observed?.[property], supported(prediction, field),
          (a, b) => valueEqual(field, a, b));
      }
      record(result, "items.azureDescription", item.description, observed?.azureDescription, supported(prediction, "items.azureDescription"),
        (a, b) => valueEqual("items.azureDescription", a, b));
      const taxable = label.taxability?.find((entry) => entry.itemId === item.id)?.taxable;
      const observedTaxable = match === null ? undefined : prediction?.taxability?.[match] ?? observed?.taxable;
      record(result, "taxability", taxable, observedTaxable, supported(prediction, "taxability"));
    });
  } else {
    for (const field of ["items.missing", "items.extra", ...ITEM_FIELDS.map((name) => `items.${name}`), "items.azureDescription", "taxability"] as ScoredField[]) {
      result.fields[field].unprinted++;
    }
  }
  if (Array.isArray(predicted) && items) {
    for (let i = 0; i < predicted.length; i++) {
      if (used.has(i)) continue;
      const item = predicted[i]!;
      for (const property of ITEM_FIELDS) {
        const field = `items.${property}` as ScoredField;
        if (defined(item[property]) && supported(prediction, field)) result.fields[field].scored++;
      }
      if (defined(item.azureDescription) && supported(prediction, "items.azureDescription")) result.fields["items.azureDescription"].scored++;
      if (defined(prediction?.taxability?.[i] ?? item.taxable) && supported(prediction, "taxability")) result.fields.taxability.scored++;
    }
  }
  if (items && Array.isArray(predicted)) result.matching = { matched: used.size, missing: items.length - used.size, extra: predicted.length - used.size };
  if (prediction === null) {
    // No replay exists: neither a wrong extraction nor a capability omission.
    for (const field of SCORED_FIELDS) {
      result.fields[field].missingRecording += result.fields[field].scored;
      result.fields[field].scored = 0;
      result.fields[field].correct = 0;
    }
  }
  return tally(result);
}
function tally(result: ScoreResult): ScoreResult {
  for (const property of ["correct", "scored", "unprinted", "unsupported", "missingRecording"] as const) {
    result[property] = SCORED_FIELDS.reduce((sum, field) => sum + result.fields[field][property], 0);
  }
  return result;
}
export function aggregateScores(results: readonly ScoreResult[]): ScoreResult {
  const aggregate = emptyResult();
  for (const result of results) {
    aggregate.receiptIds.push(...result.receiptIds);
    for (const key of ["matched", "missing", "extra"] as const) aggregate.matching[key] += result.matching[key];
    for (const field of SCORED_FIELDS) {
      for (const property of ["correct", "scored", "unprinted", "unsupported", "missingRecording"] as const) {
        aggregate.fields[field][property] += result.fields[field][property];
      }
    }
  }
  aggregate.receipts = [...results];
  return tally(aggregate);
}
function accuracy(score: FieldScore): number | null {
  return score.scored ? score.correct / score.scored : null;
}
function regression(field: ScoredField, baseline: FieldScore, candidate: FieldScore): GateRegression | null {
  const before = accuracy(baseline);
  const after = accuracy(candidate);
  if (candidate.unsupported > baseline.unsupported) return { field, baseline: before, candidate: after, reason: "lost-support" };
  if (before !== null && after !== null && after < before) return { field, baseline: before, candidate: after, reason: "accuracy" };
  return null;
}
/** Gate aggregate accuracy AND disclose regressions on individual receipts, even if they cancel out. */
export function compareScores(baseline: ScoreResult, candidate: ScoreResult): GateResult {
  const regressions = SCORED_FIELDS.flatMap((field) => {
    const found = regression(field, baseline.fields[field], candidate.fields[field]);
    return found ? [found] : [];
  });
  const receiptRegressions: GateRegression[] = [];
  const incomplete = new Set<ScoredField>();
  for (const field of SCORED_FIELDS) {
    const a = baseline.fields[field];
    const b = candidate.fields[field];
    // Extra predicted rows legitimately change the scored denominator; they do not
    // make the run incomplete. The runner checks receipt/configuration coverage.
    if (a.unprinted !== b.unprinted || b.missingRecording > 0) incomplete.add(field);
  }
  if (baseline.receipts.length !== candidate.receipts.length) {
    for (const field of SCORED_FIELDS) incomplete.add(field);
  } else {
    baseline.receipts.forEach((before, index) => {
      const after = candidate.receipts[index]!;
      for (const field of SCORED_FIELDS) {
        const found = regression(field, before.fields[field], after.fields[field]);
        if (found) receiptRegressions.push({ ...found, receiptIndex: index, receiptId: before.receiptIds[0] });
      }
    });
  }
  return {
    status: regressions.length || receiptRegressions.length ? "regression" : incomplete.size ? "incomplete" : "pass",
    regressions, receiptRegressions, incompleteFields: [...incomplete],
  };
}

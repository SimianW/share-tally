import assert from "node:assert/strict";
import { test } from "node:test";
import {
  aggregateScores, compareScores, scoreReceipt,
  type BenchmarkPrediction, type ReceiptLabel,
} from "../benchmark/scorer.js";
import { scanFailedPrediction } from "../benchmark/adapter.js";

const allFields: BenchmarkPrediction["supportedFields"] = [
  "merchant", "currency", "items", "items.description", "items.productCode",
  "items.quantity", "items.unit", "items.unitPrice", "items.linePrice",
  "items.ownDiscount", "receiptDiscounts", "subtotal", "taxLines",
  "taxTotal", "taxMode", "charges", "rounding", "total", "taxability",
];
function prediction(patch: Partial<BenchmarkPrediction> = {}): BenchmarkPrediction {
  return { supportedFields: allFields, items: [], ...patch };
}

test("null ground truth is excluded but zero and verified empty arrays are scored", () => {
  const score = scoreReceipt({
    id: "zero", merchant: null, subtotal: 0, rounding: 0,
    taxLines: null, charges: [], receiptDiscounts: [], items: [],
  }, prediction({ merchant: "Invented", subtotal: 0, rounding: null, taxLines: [], charges: [], receiptDiscounts: [] }));
  assert.equal(score.fields.merchant.unprinted, 1);
  assert.equal(score.fields.merchant.scored, 0);
  assert.deepEqual([score.fields.subtotal.correct, score.fields.subtotal.scored], [1, 1]);
  assert.deepEqual([score.fields.rounding.correct, score.fields.rounding.scored], [0, 1]);
  assert.equal(score.fields.rounding.missingRecording, 0); // null extraction is wrong, not a missing replay
  assert.equal(score.fields.taxLines.unprinted, 1);
  assert.equal(score.fields.charges.correct, 1);
  assert.equal(score.fields.receiptDiscounts.correct, 1);
});

test("tax rate decimal strings compare numerically without confusing percentages and fractions", () => {
  const label: ReceiptLabel = { taxLines: [{ label: "VAT", amount: 100, rate: "0.10" }] };
  assert.equal(scoreReceipt(label, prediction({ taxLines: [{ label: "VAT", amount: 100, rate: "0.1" }] })).fields.taxLines.correct, 1);
  assert.equal(scoreReceipt(label, prediction({ taxLines: [{ label: "VAT", amount: 100, rate: "10" }] })).fields.taxLines.correct, 0);
});

test("a derived subtotal is never scored as a printed subtotal", () => {
  const score = scoreReceipt({ subtotal: 1234, subtotalBasis: "derived-items" }, prediction({ subtotal: 1234 }));
  assert.equal(score.fields.subtotal.unprinted, 1);
  assert.equal(score.fields.subtotal.scored, 0);
});

test("matching accepts reordering and reports an inserted item separately", () => {
  const label: ReceiptLabel = { items: [
    { id: "one", description: "BREAD", linePrice: 200, ownDiscount: 0 },
    { id: "two", description: "MILK", linePrice: 300, ownDiscount: 25 },
  ], taxability: [{ itemId: "one", taxable: false }, { itemId: "two", taxable: true }] };
  const reordered = prediction({ items: [
    { description: "MILK", linePrice: 300, ownDiscount: 25, taxable: true },
    { description: "BREAD", linePrice: 200, ownDiscount: 0, taxable: false },
  ] });
  const perfect = scoreReceipt(label, reordered);
  assert.equal(perfect.fields["items.description"].correct, 2);
  assert.equal(perfect.fields["items.ownDiscount"].correct, 2);
  assert.equal(perfect.fields.taxability.correct, 2);
  assert.equal(perfect.fields["items.missing"].correct, 1);
  assert.equal(perfect.fields["items.extra"].correct, 1);
  const inserted = scoreReceipt(label, prediction({ items: [
    reordered.items![0]!, { description: "UNRELATED", linePrice: 999, ownDiscount: 0 }, reordered.items![1]!,
  ] }));
  assert.equal(inserted.fields["items.description"].correct, 2);
  assert.equal(inserted.fields["items.extra"].correct, 0);
  assert.equal(inserted.fields["items.count"].correct, 0);
  assert.equal(inserted.fields["items.linePrice"].scored, 3);
  assert.equal(inserted.fields["items.linePrice"].correct, 2);
  const missing = scoreReceipt(label, prediction({ items: [reordered.items![0]!] }));
  assert.equal(missing.fields["items.missing"].correct, 0);
  assert.equal(missing.fields["items.description"].correct, 1);
  assert.equal(missing.fields["items.description"].scored, 2);
});

test("indexed taxability follows matched items, not ground-truth row positions", () => {
  const label: ReceiptLabel = {
    items: [
      { id: "first", description: "ORANGE", linePrice: 200 },
      { id: "second", description: "SODA", linePrice: 350 },
    ],
    taxability: [{ itemId: "first", taxable: false }, { itemId: "second", taxable: true }],
  };
  const reversed = scoreReceipt(label, prediction({
    items: [{ description: "SODA", linePrice: 350 }, { description: "ORANGE", linePrice: 200 }],
    taxability: [true, false], // Parallel to prediction.items, not label.items.
  }));
  assert.deepEqual([reversed.fields.taxability.correct, reversed.fields.taxability.scored], [2, 2]);
  const missing = scoreReceipt(label, prediction({
    items: [{ description: "SODA", linePrice: 350 }], taxability: [true],
  }));
  assert.deepEqual([missing.fields.taxability.correct, missing.fields.taxability.scored], [1, 2]);
});

test("unrelated items are not force paired on index or generated ID", () => {
  const score = scoreReceipt({ items: [{ id: "same-id", description: "ORANGE", linePrice: 200 }] },
    prediction({ items: [{ description: "SOUP", linePrice: 400 }] }));
  assert.equal(score.fields["items.missing"].correct, 0);
  assert.equal(score.fields["items.extra"].correct, 0);
  assert.equal(score.fields["items.description"].scored, 2);
});

test("unsupported fields, missing recordings and nullable collections are separate", () => {
  const label: ReceiptLabel = { merchant: "SHOP", taxLines: null, items: null };
  const unsupported = scoreReceipt(label, prediction({ supportedFields: [], merchant: "SHOP" }));
  assert.equal(unsupported.fields.merchant.unsupported, 1);
  assert.equal(unsupported.fields.merchant.scored, 0);
  assert.equal(unsupported.fields.taxLines.unprinted, 1);
  assert.equal(unsupported.fields["items.count"].unprinted, 1);
  assert.equal(scoreReceipt(label, null).fields.merchant.missingRecording, 1);
});

test("unknown collection attributes are excluded, while absent and extra entries fail", () => {
  const label: ReceiptLabel = {
    taxLines: [{ label: "HST", rate: null, amount: 10 }],
    receiptDiscounts: [{ label: null, amount: 5 }],
  };
  const good = scoreReceipt(label, prediction({
    taxLines: [{ label: "HST", rate: "0.13", amount: 10 }],
    receiptDiscounts: [{ label: "COUPON", amount: 5 }],
  }));
  assert.equal(good.fields.taxLines.correct, 1);
  assert.equal(good.fields.receiptDiscounts.correct, 1);
  assert.equal(scoreReceipt(label, prediction({ taxLines: [], receiptDiscounts: [] })).fields.taxLines.correct, 0);
});

test("missing recordings are incomplete, while a missing extracted value is simply incorrect", () => {
  const label: ReceiptLabel = { merchant: "SHOP" };
  const baseline = aggregateScores([scoreReceipt(label, prediction({ merchant: "SHOP" }))]);
  const missing = aggregateScores([scoreReceipt(label, null)]);
  assert.equal(missing.fields.merchant.missingRecording, 1);
  assert.equal(missing.fields.merchant.scored, 0);
  assert.equal(compareScores(baseline, missing).status, "incomplete");
  const extractedNull = aggregateScores([scoreReceipt(label, prediction({ merchant: null }))]);
  assert.equal(extractedNull.fields.merchant.missingRecording, 0);
  assert.equal(extractedNull.fields.merchant.scored, 1);
  assert.equal(compareScores(baseline, extractedNull).status, "regression");
});

test("removing a spurious predicted item improves accuracy without making the gate incomplete", () => {
  const label: ReceiptLabel = { items: [{ description: "MILK", linePrice: 100 }] };
  const baseline = aggregateScores([scoreReceipt(label, prediction({ items: [
    { description: "MILK", linePrice: 100 }, { description: "SPURIOUS", linePrice: 999 },
  ] }))]);
  const candidate = aggregateScores([scoreReceipt(label, prediction({
    items: [{ description: "MILK", linePrice: 100 }],
  }))]);
  assert.equal(compareScores(baseline, candidate).status, "pass");
});

test("a regression on one field fails despite aggregate gains; taxability gates separately", () => {
  const label: ReceiptLabel = { id: "r1", merchant: "SHOP", currency: "CAD", subtotal: 100, total: 100, items: [
    { id: "one", description: "BREAD", linePrice: 100 },
  ], taxability: [{ itemId: "one", taxable: false }] };
  const baseline = aggregateScores([scoreReceipt(label, prediction({
    merchant: "WRONG", currency: "CAD", subtotal: null, total: null, items: [{ description: "BREAD", linePrice: 100, taxable: false }],
  }))]);
  const candidate = aggregateScores([scoreReceipt(label, prediction({
    merchant: "SHOP", currency: "USD", subtotal: 100, total: 100, items: [{ description: "BREAD", linePrice: 100, taxable: true }],
  }))]);
  const gate = compareScores(baseline, candidate);
  assert.equal(gate.status, "regression");
  assert.ok(gate.regressions.some(({ field }) => field === "currency"));
  assert.ok(gate.regressions.some(({ field }) => field === "taxability"));
  assert.ok(candidate.correct >= baseline.correct);
});

test("a dropped supported field regresses and individual regressions remain visible when aggregate ties", () => {
  const labels = [{ id: "first", merchant: "A" }, { id: "second", merchant: "B" }];
  const before = aggregateScores(labels.map((label, index) => scoreReceipt(label, prediction({
    merchant: index === 0 ? "A" : "wrong",
  }))));
  const after = aggregateScores(labels.map((label, index) => scoreReceipt(label, prediction({
    merchant: index === 0 ? "wrong" : "B",
  }))));
  const gate = compareScores(before, after);
  assert.equal(gate.regressions.length, 0);
  assert.ok(gate.receiptRegressions.some(({ field, receiptId }) => field === "merchant" && receiptId === "first"));
  assert.equal(gate.status, "regression");
  const dropped = aggregateScores(labels.map((label) => scoreReceipt(label, prediction({
    supportedFields: [], merchant: label.merchant,
  }))));
  assert.ok(compareScores(before, dropped).regressions.some(({ field, reason }) => field === "merchant" && reason === "lost-support"));
  const incomplete = compareScores(before, aggregateScores(labels.map((label) => scoreReceipt(label, prediction({
    merchant: label.merchant,
  })))));
  assert.equal(incomplete.status, "pass");
});

test("a failed production scan scores every supported, printed field as a miss", () => {
  const label = { id: "r", merchant: "SHOP", currency: "CAD", subtotal: 200, subtotalBasis: "printed", taxTotal: 0, taxMode: "exclusive",
    rounding: 0, total: 200, receiptDiscounts: [], charges: [], taxLines: [],
    items: [{ id: "item-001", description: "MILK", productCode: null, quantity: "1", unit: null, unitPrice: null, linePrice: 200, ownDiscount: 0 }],
    taxability: [{ itemId: "item-001", taxable: false }] } as unknown as ReceiptLabel;
  const score = scoreReceipt(label, scanFailedPrediction(true));
  assert.equal(score.correct, 0);
  assert.ok(score.scored > 0);
  assert.equal(score.fields["items.extra"].scored, 1);
  assert.equal(score.fields["items.extra"].correct, 0);
});

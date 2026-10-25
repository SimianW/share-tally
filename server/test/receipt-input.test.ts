import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import {
  boundingRegion, checked, claimInput, draftInput, itemEvidence,
  receiptEvidenceFields, reviewedItemsInput,
} from "../src/receipts/receipt-input.js";
import { BillError } from "../src/shared/bill-error.js";

const draft = {
  title: "", purchaseDate: "", timeZone: "UTC", notes: "",
  totalCents: null, participantIds: [], mode: "items", items: [],
};

const collections: {
  name: string;
  schema: z.ZodType;
  maximum: number;
  input: (values: unknown[]) => unknown;
}[] = [
  { name: "draft items", schema: draftInput, maximum: 200, input: items => ({ ...draft, items }) },
  { name: "participants", schema: draftInput, maximum: 16, input: participantIds => ({ ...draft, participantIds }) },
  { name: "reviewed items", schema: reviewedItemsInput, maximum: 200, input: values => values },
  { name: "claims", schema: claimInput, maximum: 200, input: claims => ({ reviewedItems: [], claims }) },
  { name: "claim reviews", schema: claimInput, maximum: 200, input: reviewedItems => ({ reviewedItems, claims: [] }) },
  { name: "polygon coordinates", schema: boundingRegion, maximum: 32, input: polygon => ({ pageNumber: 1, polygon }) },
  ...["descriptionRegions", "priceRegions", "unitPriceRegions", "regions"].map(name => ({
    name, schema: itemEvidence, maximum: 16, input: (values: unknown[]) => ({ [name]: values }),
  })),
  { name: "pages", schema: receiptEvidenceFields, maximum: 16, input: pages => ({ pages }) },
  { name: "tax details", schema: receiptEvidenceFields, maximum: 32, input: taxDetails => ({ taxDetails }) },
];

for (const { name, schema, maximum, input } of collections) {
  test(`oversized ${name} return 400 without reading any elements`, () => {
    let elementsRead = 0;
    // Count element reads rather than relying on machine-dependent timings.
    const values = new Proxy(new Array<unknown>(maximum + 1).fill(null), {
      get(target, key, receiver) {
        if (typeof key === "string" && /^\d+$/.test(key)) elementsRead++;
        return Reflect.get(target, key, receiver);
      },
    });
    assert.throws(() => checked(schema, input(values)), (error: unknown) => {
      assert.ok(error instanceof BillError);
      assert.equal(error.status, 400);
      assert.match(error.message, /Too big/);
      return true;
    });
    assert.equal(elementsRead, 0);
  });
}

test("collections at the limit still validate their elements and reject non-arrays", () => {
  for (const { schema, maximum, input } of collections) {
    assert.throws(() => checked(schema, input(new Array<unknown>(maximum).fill(null))), BillError);
  }
  assert.throws(() => checked(draftInput, { ...draft, items: {} }), BillError);
  assert.deepEqual(checked(draftInput, draft), draft);
});

test("checked formats only the first three validation issues", () => {
  const schema = z.unknown().superRefine((_value, context) => {
    for (let index = 0; index < 5; index++) {
      context.addIssue({
        code: "custom", message: "Invalid value",
        // A Symbol is a valid Zod path key but cannot be joined into a message.
        path: [index < 3 ? `field${index}` : Symbol("must not be formatted")],
      });
    }
  });
  assert.throws(() => checked(schema, null), (error: unknown) => {
    assert.ok(error instanceof BillError);
    assert.equal(error.status, 400);
    assert.equal(error.message, "field0: Invalid value; field1: Invalid value; field2: Invalid value");
    return true;
  });
});

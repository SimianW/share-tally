import assert from "node:assert/strict";
import { test } from "node:test";
import { receiptLineGeometry } from "../src/play/receipt-line-geometry.ts";

test("scales the analyzed polygon into the displayed photo's dimensions", () => {
  const geometry = receiptLineGeometry(
    [100, 200, 900, 200, 900, 240, 100, 240],
    { width: 1000, height: 2000 },
    { width: 500, height: 1000 },
  );
  assert.deepEqual(geometry, {
    viewBox: "0 38.57142857142857 500 142.85714285714286",
    points: "50,100 450,100 450,120 50,120",
  });
});

test("uses every vertex to bound a skewed, rotated line and centers its crop", () => {
  const geometry = receiptLineGeometry(
    [250, 350, 650, 300, 750, 330, 150, 390],
    { width: 1000, height: 1000 },
    { width: 1000, height: 1000 },
  );
  assert.deepEqual(geometry, {
    viewBox: "0 202.14285714285714 1000 285.7142857142857",
    points: "250,350 650,300 750,330 150,390",
  });
});

test("does not highlight invalid or mismatched coordinate spaces", () => {
  assert.equal(receiptLineGeometry([1, 2], { width: 100, height: 100 }, { width: 100, height: 100 }), null);
  assert.equal(receiptLineGeometry([1, 1, 20, 1, 20, 20], { width: 100, height: 100 }, { width: 200, height: 100 }), null);
});

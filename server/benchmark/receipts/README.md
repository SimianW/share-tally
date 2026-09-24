# Labelled receipt benchmark

This is the image and ground-truth part of [#49](https://github.com/SimianW/share-tally/issues/49), supporting the field-by-field release gate in [#47](https://github.com/SimianW/share-tally/issues/47). It is **not** recorded Azure evidence and does not yet run either receipt pipeline. No paid API was called to build it.

The location `server/benchmark/receipts/` keeps licensed test material out of production assets and separates human labels from the stored-analysis format introduced in #48. Do not use these labels as simulated OCR evidence: the later replay harness must use separately recorded provider responses.

## Selection and coverage

The Open Prices selection contains **12 Canadian proofs**: 4 Costco, 4 Walmart, 1 Real Canadian Superstore, 1 No Frills, 1 Food Basics and 1 Save-On-Foods. It does **not** contain four Superstore receipts. As of **2026-09-24**, API pages 1–2 returned **153 CAD receipt proofs**; the source survey found only proof **7928** to be a complete Superstore receipt. Three other Canadian grocers fill those intended slots, with their real merchant identities preserved in filenames, labels and provenance. This is a dated selection limitation, not a permanent assertion about the API. The substitutions add explicit membership savings and Ontario/BC tax-line coverage.

Three discounted, taxed **CORD v2** receipts provide non-Canadian coverage. Five **ExpressExpense SRD** restaurant receipts replace the requested Enterprise Receipt Corpus: the Zenodo record has record-level CC BY 4.0 metadata but no separate statement establishing image rights. Those images are excluded under the task's stricter image-rights criterion. ExpressExpense's dataset-specific source page explicitly identifies **200 receipt images**, offers that dataset under **MIT**, and requests credit to ExpressExpense.com. Its archive has no contrary dataset-specific licence or restriction. The manifests quote that grant, link the source and record the retrieval date. Generic website terms restrict copying site content; the specific dataset grant is the basis for distributing these five images, not a licence to copy the rest of the website.

CORD's official v2 dataset card explicitly specifies CC BY 4.0. The related [maintainer discussion in issue #4](https://github.com/clovaai/cord/issues/4) explains why the **complete corpus** was difficult to release owing to owner-consent contact issues, then offers the improved existing sample as CORD v2. It does not assert a consent defect in the released v2 images. That context is recorded in each manifest entry; this benchmark includes released v2 samples only.

Three owner slots remain empty for #50. They are not counted among public-source receipts. Receipt selection favors legibility and reconcilable arithmetic; it is a curated regression suite, not a representative estimate of real-world OCR accuracy.

## Layout

- `open-prices/`: Canadian receipt proofs; each `manifest.json` entry refers to a redacted PNG and its label JSON.
- `express-expense/`: five MIT-licensed SRD image samples, substituted for Enterprise because of its image-rights uncertainty.
- `cord/`: non-Canadian CORD v2 receipts, labelled in their original currency.
- `owner-slots/manifest.json`: three **empty** slots for the owner to fill under #50, not benchmark observations.
- `FORMAT.json`: versioned, machine-readable contract, examples, and conventions.
- `ATTRIBUTION.txt`: dataset-wide licence and attribution notice. Per-image provenance, rights evidence and redaction details live in the corpus manifests.
- `../validate_receipts.py`: offline dataset-integrity checker, using only Python's standard library.

Each receipt has an independent provenance record. `originalSha256` identifies the downloaded bytes before redaction; `imageSha256` identifies exactly the committed redacted PNG. Original images, scratch crops, OCR transcripts and payment details are not part of the repository. The checker rejects duplicate original or committed image hashes.

## Ground-truth contract (version 1)

Each JSON has merchant, ISO currency/country and province/region context; ordered `items`; `receiptDiscounts`; `subtotal`; individual `taxLines`; `taxTotal`; `charges`; `rounding`; `total`; and a **separate** `taxability` array keyed by item ID.

- Money is **integer minor units**, with `currencyExponent: 2` throughout. CAD 12.34 is `1234`; IDR Rp 12,000 is `1200000`. There are no floating-point money values.
- Quantity and fractional tax rate are decimal **strings**. A printed 13% rate is `"0.13"`, not `13`. An implicit single purchased line has quantity `"1"` with `quantityBasis: "implicit-single-line"`; explicitly printed quantities have a printed basis. Weighted quantities keep their printed unit.
- `description` is the printed item text, not an English name invented by a model. `productCode` is separate when identifiable. Preserve line order and repeated products rather than coalescing them. Unpriced meal components may be documented in notes but are not invented as paid items.
- `merchant` may be `null` when the source has obscured the merchant header; it is then not scored. `unitPrice` is `null` when unprinted. Do not fill it by division. A `null` expectation is excluded from that field's scoring, never treated as zero. A zero amount or empty list means verified zero/absence.
- `linePrice` is the purchased line's amount **before its own discount**. `ownDiscount` is a positive reduction, accompanied by printed `discountLabels`. For a printed net line with a separately shown saving, explain any recovered gross amount in item notes; do not pretend that recovery is printed. Negative coupons are not claimable items.
- `receiptDiscounts` are positive reductions genuinely applying to the receipt, with printed labels. An unexplained reconciliation gap is never labelled a discount. Discount ownership is ground truth from the image, not a prediction of whether ADR-0012's conservative parser will accept it.
- `subtotalBasis` distinguishes `printed` from `derived-items` where no subtotal exists. A derived subtotal is an arithmetic expectation, **not** a printed-field extraction target. The replay harness should report printed-field and derived-value coverage separately.
- `taxLines` preserve each printed label, amount and rate. An unprinted rate is `null`, with `rateBasis` explaining the absence; the tax amount still scores. Do not collapse separate GST/PST lines into an invented printed rate. Multi-tax receipts remain useful extraction tests even though production supports only a single allocation rate.
- `taxMode: "exclusive"` means tax is added to subtotal; `"inclusive"` means the printed tax is already contained in the item/subtotal amounts. Do not reconstruct pre-tax item prices on inclusive receipts.
- `charges` preserve non-item fees with an explicit `stage` (`before-subtotal` or `after-subtotal`). `rounding` is signed and must be supported by the image, not used to hide OCR errors.
- Each item has exactly one separate taxable boolean. Bases are `printed-code`, `printed-tax`, or `jurisdiction-rule`, with textual evidence and primary-source URLs for rule-based judgements. Taxable means the item bears any tax on this receipt, not that its category always bears tax in every jurisdiction. Canadian zero-rated basic groceries are `false`; non-Canadian labels follow that receipt's local evidence, not Canadian rules. Names and monetary extraction are not taxability scores.

### Reconciliation

With all quantities already included in the line prices, and `subtotalStage: "after-discounts"` (the default):

```text
sum(linePrice - ownDiscount) - sum(receiptDiscounts.amount)
  + sum(charges before subtotal) = subtotal

subtotal + (taxTotal if exclusive, otherwise 0)
  + sum(charges after subtotal) + rounding = total

sum(taxLines.amount) = taxTotal
```

Some CORD receipts print a subtotal **before** discounts. For `subtotalStage: "before-discounts"`, preserve that printed subtotal: sum gross `linePrice` plus before-subtotal charges to obtain it, then subtract all own and receipt-wide discounts when reconciling from subtotal to total. A repeated total-summary discount is not counted again if it already belongs to an item.

All equations must match **exactly in minor units**. The dataset checker is intentionally stricter than ADR-0012's one-cent runtime reconciliation tolerance. It cannot prove that a description was transcribed correctly, that a redaction covers all private data, or that a legal interpretation is correct; those require visual/source review.

## Validate without credentials or network

From the repository root:

```sh
python3 server/benchmark/validate_receipts.py
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s server/benchmark -p 'test_*.py'
```

The first command checks receipt and owner-slot counts, label structure, exact arithmetic, per-item taxability coverage, source/provenance fields, image hashes, duplicate images, redaction-box bounds, PNG checksums and absence of image metadata. It deliberately accepts only PNG structural/pixel chunks, so EXIF, GPS, comments and embedded profiles cannot be accidentally retained. It also rejects unreferenced files in source directories.

## Add the owner's receipts (#50)

1. Choose one empty slot. Confirm that the owner took the photo and consents to public redistribution; choose and record an image licence. A slot is not consent and supplies no licence.
2. Work on the original image **outside this repository**. Record its SHA-256. Visually inspect the full-resolution image and irreversibly cover payment card/account digits, membership/loyalty numbers and all people's names (including cashier/server names). Cover transaction/rewards barcodes and QR codes where they could encode private identifiers. Keep merchant details, items, tax legends and amount-due lines intact.
3. Save a fresh RGB PNG with no metadata. Record every redaction as `[left, top, right, bottom]` in committed-image coordinates, right/bottom exclusive, plus a reason. Record source/copyright attribution, date and the redacted PNG's SHA-256. Never commit the original.
4. Hand-transcribe the image using `FORMAT.json`; reconcile its arithmetic and document the basis of **every** taxable label. Replace a receipt if an essential amount or description cannot be read without guessing.
5. Replace the empty slot record with normal provenance and add its PNG/JSON. Run validation with the new expected counts, for example `--expected-receipts 21 --expected-owner-slots 2` after filling one slot.
6. Record Azure/model responses in #50 only after agreeing the #48 evidence format. Record against the **committed redacted image**, so redacted names/card data never enter public response fixtures. Do not backfill these JSON labels from provider predictions.

## Continuation boundary

The next part of #49 is blocked on #48's stored-evidence format. The future harness must pair each image/label ID with raw Azure analyses for default, `locale=en`, and `ocrHighResolution`, and with recorded model responses. It must run offline, compare current and new pipelines field by field, score taxability independently, show scored-versus-unprinted coverage, and fail the release gate on regressions. The dataset-integrity command above is not that release gate. Do not open the #49 PR until the harness is added.

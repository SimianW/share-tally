# Receipt extraction demo

Throwaway branch `demo/receipt-extraction`. Compare AI SDK and receipt-ai-scanner using the same Gemini model on 11 actual public receipt scans. There are no simulated extraction results.

Run from `server/`:

```sh
pnpm install
pnpm demo:receipts
```

Install `client/` dependencies too if this is a fresh checkout. The command serves the demo on port 5180 without the production API, database, or sign-in. This is a development server, not a public deployment.

- AI SDK: http://dev-2a1m:5180/#/prototype/receipts/ai-sdk
- Receipt library: http://dev-2a1m:5180/#/prototype/receipts/receipt-scanner

Add `GOOGLE_GENERATIVE_AI_API_KEY` to `server/.env`. `GEMINI_API_KEY` also works. The key stays server-side. The refresh button detects a newly added key without restarting. Restart after changing an existing key. Set `RECEIPT_DEMO_MODEL` in the process environment to select another Gemini vision model; the default is `gemini-2.5-flash`.

Click **Run all 22 extractions** to run both libraries on all receipts sequentially. Calls consume provider quota. Every new sample attempt, including errors, saves its result and timestamp in `server/demo/results/`. Latest results load into the pages; `results/history/` retains new attempts even after a rerun. These files are actual model responses, not ground truth. Uploads remain in browser/server memory and do not save images or responses to disk.

## Samples and expectations

The 11 images and OCR annotation CSV files come from [zzzDavid/ICDAR-2019-SROIE](https://github.com/zzzDavid/ICDAR-2019-SROIE/tree/master/data), downloaded on 2026-09-15. The subset contains Malaysian and Moroccan receipts. Source links appear beside every image. These are original scans, without synthetic blur, rotation, cropping or contrast changes in model inputs. SHA-256 values in the manifest identify the original images. Local inspection crops were only used to read small text and are not model inputs.

Eight harder scans extend the original three: `010`, `075`, `175`, `225`, `275`, `450`, `525`, and `550`. Cases include skew, faint thermal print, severe fading, pen marks, bulk quantities, French labels, multiple coupon rows, and unpriced meal components. Samples were selected by visual inspection before extraction, not by observing model failures.

`receipts/manifest.json` records item descriptions, line amounts, quantities, printed unit prices, tax, discounts and totals, transcribed from OCR annotations and checked against the scans. SROIE does not provide structured item objects; these expectations are our manual labels. The models receive only the original image and extraction instructions, never the expected values or transcripts.

The eight scored fields are total, priced-row count, ordered line amounts, quantities, unit prices, currency, discount, and tax. Missing expected quantity/unit-price/discount/tax fields are not scored. RM/MYR and DH/MAD are treated as equivalent. Unknown currency is accepted when a symbol/code is not printed, but an incorrect token such as SR still fails. This absent-currency scoring rule was clarified after inspecting the outputs; monetary and item labels were recorded before the calls and remained unchanged. No model response was modified or rerun to improve its score.

Two important interpretation limits:

- Receipt 275's first price is extremely faint. The source transcript says 6.85 and that reconciles the printed total. The models read 4.85. This is a mismatch against the source label, not proof that every human could recover that glyph from the image alone.
- For McDonald's 550, only two rows have prices. Unpriced Coke/fries/sauce are meal components. The row check expects two priced meals, not five separately charged items. Rounding is displayed but excluded from shared checks because receipt-ai-scanner has no corresponding schema field. Description spelling and discount-to-item associations require manual review; eight passing fields are not complete semantic correctness.

The SROIE mirror has an MIT software license, but we did not establish an explicit image/data license. Do not describe its dataset as confirmed open-licensed. See [the dataset research](../../research/2026-09-15-open-receipt-datasets.md) for CORD v2, the preferred alternative with explicit CC BY 4.0 terms and item-level labels. The demo includes links to CORD, SROIE and WildReceipt.

## Integration observations

- receipt-ai-scanner 1.2.0 eagerly imports `@anthropic-ai/sdk` even for Gemini. That dependency must be installed for this package to load.
- Both libraries use an 8,192-token output allowance and a 90-second extraction timeout. AI SDK disables automatic retries. The receipt library's provider SDK may apply its own retries.
- The receipt library uses strict validation, but its schema still defaults missing totals/items. Parsed output is not proof of correct reading.
- Demo routes render only in Vite development mode. No bill or share workflow is connected.

## Observed results

All 22 attempts used Gemini 2.5 Flash. The original six responses were retained; 16 new calls tested the eight added images once per library. The prompt, schema, model and output budget were unchanged from the first demo. Successful responses and error records load automatically into both pages.

| Measure | AI SDK | receipt-ai-scanner |
| --- | --- | --- |
| Attempts with usable parsed output | 11/11 | 9/11 |
| Receipts matching all applicable scored fields | 9/11 | 4/11 |
| Correct final total with usable output | 11/11 | 9/11 |

AI SDK's two failures are 275's faded price, 4.85 versus source-label 6.85, and 525's currency, where it emits GST marker SR. It otherwise gets the long receipt's 12 amounts, three-discount sum, and rounding right. Minor description differences remain, including 2INI instead of 2IN1.

receipt-ai-scanner fails JSON parsing on 175 and 525. On 001, 225 and 275, the raw JSON repeats keys inside one object. JavaScript JSON parsing keeps the last values, silently dropping an item even though it appears in the raw transcript. On 010 and 075, the output converts printed gross prices to pre-tax amounts, contrary to the requested extraction contract. Its usable outputs all have correct grand totals, illustrating why total-only scoring misses failures.

The UI includes per-field expected/returned values, error rows, source links and manual review notes. Click a receipt name in the comparison to inspect the relevant page. Confidence values from the model are not used in scoring.

These are one run per sample, not a representative accuracy or speed benchmark. The two libraries retain different prompts and schemas and call different Google API interfaces despite selecting the same model. Public datasets may have appeared in model training. This comparison supports a prototype choice, not an estimate of production accuracy.

Recompute the report without any model calls:

```sh
node --import=tsx demo/evaluate-results.ts
```

The report is `results/evaluation.json`; the UI uses the same evaluator. Client build, targeted lint, demo server type checks, and browser checks cover the expanded collection, saved error/success views, eight-field scores, source/dataset links and mobile layout.

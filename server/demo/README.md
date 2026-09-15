# Receipt extraction demo

Throwaway branch `demo/receipt-extraction`. Compare AI SDK and receipt-ai-scanner using the same Gemini model on three actual public receipt scans. There are no simulated extraction results.

Run from `server/`:

```sh
pnpm install
pnpm demo:receipts
```

Install `client/` dependencies too if this is a fresh checkout. The command serves the demo on port 5180 without the production API, database, or sign-in. This is a development server, not a public deployment.

- AI SDK: http://dev-2a1m:5180/#/prototype/receipts/ai-sdk
- Receipt library: http://dev-2a1m:5180/#/prototype/receipts/receipt-scanner

Add `GOOGLE_GENERATIVE_AI_API_KEY` to `server/.env`. `GEMINI_API_KEY` also works. The key stays server-side. The refresh button detects a newly added key without restarting. Restart after changing an existing key. Set `RECEIPT_DEMO_MODEL` in the process environment to select another Gemini vision model; the default is `gemini-2.5-flash`.

Click **Run all 6 extractions** to run both libraries on all receipts sequentially. Calls consume provider quota. Each successful sample run saves its result and timestamp in `server/demo/results/`, shown again when opening the pages. These files are actual model responses, not ground truth. Uploads remain in browser/server memory and do not save images or responses to disk.

## Samples and expectations

Images `000.jpg`, `001.jpg`, and `002.jpg` and their OCR annotation CSV files came from [zzzDavid/ICDAR-2019-SROIE](https://github.com/zzzDavid/ICDAR-2019-SROIE/tree/master/data), downloaded on 2026-09-15. The upstream README identifies these as scanned receipts from the ICDAR 2019 SROIE dataset. Source links appear beside each image and expected result. Third-party dataset assets retain their upstream terms; this demo does not relicense them.

`receipts/manifest.json` records expectations transcribed from annotations: final rounded total, purchased item row count, gross line amounts, separate discount, and rounding. These are Malaysian receipts in MYR, not Costco/CAD examples. Models receive only image bytes and extraction instructions, never expected answers or transcripts.

Comparison checks cover totals, item counts, and gross line amounts in receipt order. They are not an overall accuracy score and do not judge descriptions, quantities, or discount associations. Both libraries receive the same supplemental instructions, but receipt-ai-scanner retains its built-in prompt and schema. This compares integration approaches, not just model performance.

AI SDK captures signed rounding separately. receipt-ai-scanner has no rounding field in its built-in schema, so the UI displays it as unknown; the full raw response remains inspectable.

## Integration observations

- receipt-ai-scanner 1.2.0 eagerly imports `@anthropic-ai/sdk` even for Gemini. That dependency must be installed for this package to load.
- Both libraries use an 8,192-token output allowance and a 90-second extraction timeout. AI SDK disables automatic retries. The receipt library's provider SDK may apply its own retries.
- The receipt library uses strict validation, but its schema still defaults missing totals/items. Parsed output is not proof of correct reading.
- Demo routes render only in Vite development mode. No bill or share workflow is connected.

## Observed results

Six actual Gemini 2.5 Flash calls completed on 2026-09-15. Saved responses are in `results/` and load automatically into both pages.

| Receipt | AI SDK | receipt-ai-scanner |
| --- | --- | --- |
| 000, one item | Total, item count, line amount match; 5.1 s | Same checks match; 8.9 s |
| 001, discount and rounding | Both items and total match; 5.9 s | Total matches, but misses the RM 10 privilege-card item; 13.5 s |
| 002, four items | All three checks match; 6.3 s | All three checks match; 13.2 s |

AI SDK matched all three checks on 3/3 receipts. receipt-ai-scanner matched them on 2/3. The second receipt demonstrates why a matching grand total is insufficient: the scanner returns 60.30 while omitting a purchased line. These are one run per sample, not a representative accuracy or speed benchmark. The libraries use different prompts/schemas and different Google API interfaces despite selecting the same model.

Client build, demo server type check, and targeted client lint passed. Browser smoke checks cover both routes, sample selection, upload, mobile layout, image loading, missing-key responses, saved real output, and comparison results. No automated bill/share tests are needed because the demo is disconnected from those workflows.

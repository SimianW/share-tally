# Offline receipt benchmark

This directory implements the replay and labelled-data parts of [#49](https://github.com/SimianW/share-tally/issues/49). The production evidence shape comes from #48: `receipt_evidence.analysis` is the complete Azure **analysis result**, not a polling envelope or selected fields.

## What is available now

- **24 licensed, privacy-redacted images and hand-checked labels** in `receipts/`: 20 public-source receipts and 4 owner receipts (#50). See [selection, licences and labelling conventions](receipts/README.md).
- **11 legacy diagnostic labels** in `legacy/`, paired with sanitized raw Azure analyses already checked into `server/test/fixtures/azure-receipt/`. These demonstrate the real mapper and current processing pipeline offline. They are **not** members of the 20-image release denominator. Source images are not copied because their redistribution rights were not confirmed.
- **No Azure recordings for the new images yet**: 24 images × 3 configurations = **72 missing analyses**, to be recorded by the owner in #50.
- **No genuine staged model recordings in the earlier comparison archive**. That archive's direct-image Gemini extraction is a different experiment, not an Azure-to-naming/taxability response. Both diagnostic pipelines use their production no-model fallback and report model coverage as missing; it is not a full-pipeline release pass.

The **offline replay command** never obtains credentials, submits a photo or contacts Azure/the model. Provider results are replayed only from local files. The separate, explicitly opt-in `benchmark:record` command is a **live, potentially paid owner operation** for #50; implementing it does not authorize running it. Tests use explicitly synthetic provider responses to check recording/replay mechanics; those are not passed off as real recordings or public-dataset accuracy evidence.

## Offline commands and reports

From the repository root, using the pinned pnpm version:

```sh
corepack pnpm@12.3.4 --dir server benchmark
corepack pnpm@12.3.4 --dir server benchmark --allow-incomplete --json /tmp/receipt-benchmark.json
corepack pnpm@12.3.4 --dir server benchmark --candidate /absolute/path/to/candidate.ts --json /tmp/receipt-benchmark.json
```

Without `--candidate`, the command compares the frozen #48 baseline against the **built-in `two-stage` candidate**, using current production #51 names/taxability and #52 discount attachment. `--candidate PATH` remains a trusted local adapter override, with a distinct ID and separate recordings. `--json` without a filename emits only machine-readable JSON; with a filename it writes JSON there and prints the readable report. `--recordings PATH` overrides the recording directory, and `--root PATH` overrides the corpus root (primarily for tests). Paths supplied on the command line resolve from the command's working directory; absolute paths avoid ambiguity.

Exit codes are **0** for pass, **1** for any detected regression, and **2** for incomplete coverage, malformed inputs or invalid usage. `--allow-incomplete` allows exit 0 only for a non-regressing, well-formed diagnostic run; it does not turn the report's INCOMPLETE status into PASS and never suppresses a regression or malformed input.

Reports separate public release cases from legacy diagnostics and show per-field and per-receipt scores, taxability independently, and unprinted, unsupported and missing-recording coverage. The gate requires **at least 20** licensed, redacted receipts, with all three Azure configurations and complete baseline and candidate model replay for **every included receipt**, plus no regression in comparable field or receipt results. Completed owner receipts added as a normal source directory count too. Improvements elsewhere must not cancel an individual receipt/field loss. `runner.ts` exports `runBenchmark` and `readableReport`; `cli.ts` is the command wrapper.

The committed-data run is expected to report **INCOMPLETE**: all 72 Azure analyses and staged model responses still need genuine owner recording. Do not use `--allow-incomplete` as the production release gate.

## Recording layout for the owner (#50)

Record against the **committed, redacted PNG**, never the original source photo. Confirm the PNG's SHA-256 matches its source manifest before submitting it. The recorder then applies both production upload steps and submits the result: the browser's compression in `client/src/play/ReceiptPhoto.tsx` (scale to fit 2400 × 6000, JPEG quality 0.9), then the server's `normalizeReceiptPhoto` in `src/receipt-photo.ts` (8 MB input cap, EXIF rotation, fit inside 2400 × 6000, JPEG quality 90). Azure therefore analyses the same bytes a user upload of this image would produce, and every request stays under Azure's free-tier 4 MB limit; several committed PNGs exceed it, and one exceeds the 8 MB server cap on its own. One analysis per image/configuration:

```text
server/benchmark/recordings/
  open-prices-costco-21942/
    default.json
    locale-en.json
    ocr-high-resolution.json
    default.model.baseline.json
    default.model.two-stage.json
    locale-en.model.baseline.json
    ...
```

The exact filename conventions used by the runner are defined in `runner.ts`; do not manufacture missing variants by copying a default recording. Missing files are missing coverage. Keep originals, payment details, credentials, bearer tokens and private endpoints out of recordings and git.

### Explicitly live recording command

**Owner action only; sends redacted receipt contents to external providers and may incur charges. No live calls were made to implement or test this benchmark.** Replay does not need any of these credentials. The recorder reads already-exported environment variables; it does not load or write `.env` files.

| Environment variable | Purpose |
| --- | --- |
| `AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT` | Your Azure Document Intelligence HTTPS resource endpoint; required for new Azure analyses. |
| `AZURE_DOCUMENT_INTELLIGENCE_KEY` | Azure resource API key; required for new Azure analyses. Never saved. |
| `RECEIPT_NAME_API_KEY` | Model API key; required for baseline and built-in candidate model recording, except the default OpenAI fallback below. Never saved. |
| `OPENAI_API_KEY` | Alternative only when `RECEIPT_NAME_API_KEY` is absent and the base URL is exactly the default `https://api.openai.com/v1`. A custom gateway must use its own `RECEIPT_NAME_API_KEY`. Never saved. |
| `RECEIPT_NAME_MODEL` | Required model identifier, even with the default provider. This non-secret configuration is recorded. |
| `RECEIPT_NAME_BASE_URL` | Optional model API base URL; defaults to `https://api.openai.com/v1`. Must contain no credentials, query parameters or fragment. This non-secret configuration is recorded. |

After separately exporting credentials securely, an owner can start with one case:

```sh
corepack pnpm@12.3.4 --dir server benchmark:record --help
# LIVE / potentially paid; not a validation command:
corepack pnpm@12.3.4 --dir server benchmark:record --confirm-paid-requests --receipt open-prices-costco-21942 --config default
```

Omitting `--receipt` selects all 24 release images; omitting `--config` selects all three exact configurations. The default records Azure, the frozen baseline model, and the built-in `two-stage` model. The built-in candidate uses exactly the existing `RECEIPT_NAME_*` environment variables above: **no extra credentials**. Its normal model call uses production’s 40-second HTTP cancellation signal (RECEIPT_MODEL_TIMEOUT_MS), names/taxability request and response parser. `--azure-only` deliberately leaves model coverage incomplete. Existing valid recordings are reused without new calls for that stage; `--overwrite` explicitly replaces observations and can charge again. Preserve any old observations you need before choosing overwrite. Each completed Azure result is saved independently, so a later model-stage failure does not discard it.

`--candidate-recorder /absolute/path/to/module.ts` overrides the built-in candidate recorder by loading a trusted module with a default `CandidateRecorder` export from `record.ts`. It has distinct `id`, contract `version`, and `record({analysis, env, request})`, returning non-secret `config`, full actual `input`, optional post-filter draft-order `itemIds`, and the actual `outcome`. Pair it with a replay adapter using the same ID/version and request builder. Existing built-in candidate observations are reused only after rebuilding their exact input with saved IDs and checking version/configuration; input drift requires an explicit new recording rather than silent reuse. Candidate plugins must document any additional credentials and must never return keys, headers or secret-bearing URLs. The framework saves its response under the candidate ID, never under the baseline ID. `--azure-only` and `--candidate-recorder` cannot be combined.

The command refuses to run without `--confirm-paid-requests`. It checks recording schemas, image hashes and obvious secret-bearing values before saving; these checks do not replace inspecting raw OCR and provider responses before commit. Files are written atomically and are not silently overwritten. Observed model errors/timeouts are retained as outcomes, not invented success responses; Azure submission/poll failures stop recording without manufacturing analysis. A recording failure returns exit 1.

### Azure envelope

```json
{
  "schemaVersion": 1,
  "imageSha256": "<64-character SHA-256 of committed PNG>",
  "request": {
    "apiVersion": "2024-11-30",
    "modelId": "prebuilt-receipt",
    "options": {}
  },
  "analyzeResult": { "documents": [{ "fields": {} }] }
}
```

The example analysis above only illustrates structure; **save the entire actual analysis result**, including raw content, pages, confidence, field evidence and model/API metadata. The analysis object must have the same shape as #48's `receipt_evidence.analysis`. Do not replace it with normalized items, strip difficult lines or correct OCR mistakes using ground truth.

Configuration request objects are exact:

| File configuration | `request.options` |
| --- | --- |
| `default` | `{}` |
| `locale-en` | `{"locale":"en"}` |
| `ocr-high-resolution` | `{"features":["ocrHighResolution"]}` |

Both `apiVersion` and `modelId` remain as above. Image hash, requested configuration and response metadata are checked on replay. The Azure envelope deliberately contains **no model response**: each pipeline/model contract needs its own recording.

### Model envelope, separately for each adapter/version

```json
{
  "schemaVersion": 1,
  "version": "<adapter-specific model contract version>",
  "config": { "model": "<actual model>", "baseURL": "<public API base URL without secrets>" },
  "input": { "<complete actual serialized request body>": "..." },
  "inputSha256": "<canonical JSON SHA-256>",
  "outcome": { "kind": "result", "value": { "<complete recorded response>": "..." } }
}
```

- `version` identifies the model contract, not the Azure configuration. The built-in baseline uses `receipt-names-responses-v1`, with `config` containing only the actual `baseURL` and `model` (never the API key). It replays the full recorded Responses-API result through the frozen baseline interpretation parser. The built-in `two-stage` candidate uses `receipt-evidence-names-taxability-v1`; it returns names and taxable booleans and has separate files from the frozen baseline. Candidate replay uses the real production provider-envelope parser and `applyReceiptModelResult`, including partial, invalid, timeout and error fallback.
- `input` is the complete JSON request the adapter freshly builds, including prompt and item evidence. Generate `inputSha256` with the exported `inputHash` from `recordings.ts`, which hashes canonical JSON (sorted object keys; array order is significant). Do not hash prettified file bytes.
- For an observed timeout use `{"kind":"timeout"}`; for an observed error use `{"kind":"error"}` or `{"kind":"error","message":"sanitized diagnostic"}`. These are observed outcomes, not substitutes for an unrecorded call.
- An adapter using persisted item IDs can store `itemIds: ["...", "..."]` in **post-filter draft-item order** (not original raw Azure row order). It must call `input.itemIds(count)` and use those same IDs to build model input and apply results; fresh random draft UUIDs would invalidate an otherwise identical replay. IDs have no relationship to ground-truth item matching. The built-in recorder preserves actual generated UUIDs; diagnostic replay without recorded IDs uses the runner’s unchanged `"0"`, `"1"` defaults. Production pricing happens before replacing generated IDs with replay IDs; final allocation is not a scored field, so no repricing or draft/API UUID-validation change is necessary.
- `input.replay(freshInput, {version, config})` compares the newly built request with the recording, verifies its canonical hash and contract/config expectations, then returns a cloned recorded outcome. A changed prompt/item shape produces **input drift**, not a fresh network call or silently reused output.
- Each candidate plugin chooses and validates its own non-secret configuration. Baseline replay reconstructs the request using the recorded model/base URL, not deployment environment variables. A benchmark compares recorded configurations; it does not prove that a later deployment's model configuration is identical.

For **zero mapped items**, both current production and the frozen interpreter skip HTTP. Record an explicit `outcome: {"kind":"skipped","reason":"no-items"}` rather than inventing a model response. `input` is then a hashed no-call marker (`kind: "no-model-call"`, `reason: "no-items"`, and the freshly derived non-secret config/evidence), not a provider request. Current production returns its local empty result and the pure applicator reports `ok`; the candidate reproduces that exact behavior. Replay still validates version, config, input, and zero-item IDs, and rejects a skipped outcome for nonempty input or a provider response for empty input. These validated observations count as complete pipeline execution, not missing coverage. If model recordings are entirely absent, coverage remains incomplete even for empty items.

A failed/partial response may be a valid recording and should exercise production fallback behavior. Do not replace it with a successful rerun while claiming it is the same observation. Never derive a model response from labels.

## Adapter boundary for #51 and #52

`adapter.ts` exports `BenchmarkAdapter` and `AdapterInput`. A trusted local adapter exports an object with:

```ts
{
  id: "candidate-v1",
  requiresModel: true,
  run: async (input) => prediction
}
```

The adapter receives raw `analysis`, a separate model `recording`, `itemIds(count)`, and `replay(freshInput, expectedContract)`. It receives **no label JSON**. Return a `BenchmarkPrediction` from `scorer.ts`: monetary fields are integer minor units; printed description is distinct from any model-renamed item; taxable booleans are scored independently.

Every predicted item must declare `sourceIndex: number | null`: the **original raw Azure Items index**, preserved through reordering/filtering (especially when #52 removes coupon rows), or null only for a truly new row without Azure item provenance. Missing, duplicate, noninteger or out-of-range indices fail the adapter run. Do not renumber source indices after filtering.

`items.description` must stay the pipeline's actual production `originalText`. The runner always derives the separate `items.azureDescription` metric using the shared `azurePrintedDescription`/`projectAzureDescriptions` helpers in `adapter.ts`: `Description.valueString ?? Description.content ?? null`. Any plugin-supplied `azureDescription` is overwritten. This prevents cleaning one pipeline's text but not the other's. Item matching prefers this shared Azure description, supplemented by product code and line price, identically for all adapters. `ScoreResult.matching` reports matched, missing and extra item counts; unmatched predicted rows still count as errors.

The built-in baseline uses the preserved mapping, processing, model request builder/parser and pricing behavior in `frozen-baseline/`, pinned to #48 commit `16509935cb34d505ee8d48c5616c2a22ff908e2f`. `baseline.ts` composes them with an injected recorded interpreter. This intentional snapshot must not change when #51 replaces the production model contract or #52 changes discount attachment. Parity tests compare the snapshot with that production version. The separately exported production `mapAzureAnalysis` remains the extractor's pure conversion; network submission/polling are outside it.

`candidate.ts` implements the current pipeline using production `mapAzureAnalysis` followed by synchronous `processReceipt`. Discount attachment happens inside `normalizeAzure`, before draft processing. Only then does it obtain `input.itemIds(draftItems.length)`, build `receiptModelEvidence`, serialize the production request, and call `input.replay(freshInput, {version, config})`. Recorded provider envelopes are parsed by production `parseReceiptNameResponse`; the pure `applyReceiptModelResult` owns names and taxability. The model never owns money. Predictions use Azure printed line amounts, own/receipt-wide discounts and summary amounts, not allocated final costs.

`azureItemRowIndices` is a shared pure **transient** selector used by normalization and the benchmark. It binds each prediction to its original raw Azure row index despite removed coupon rows and duplicate descriptions. Only benchmark predictions receive `sourceIndex`: draft/API items, stored evidence and model input do not. `invokeAdapter` alone supplies `azureDescription` from those raw rows; the candidate does not clean or fabricate it.

Keep candidate logic separate from `frozen-baseline/`: that directory remains byte-for-byte pinned to `16509935cb34d505ee8d48c5616c2a22ff908e2f`. Frozen Azure parity tests compare committed snapshots captured from **actual pinned production**, not today’s changed mapper. Current pure-mapper/extractor parity excludes nondeterministic `scanTimings`; raw analysis is checked separately. The synthetic frozen request fixture was also captured from pinned production, is labelled synthetic, and is not a live accuracy recording.

`requiresModel: false` adapters can provide Azure-only diagnostics, but cannot complete the full release gate. A model-dependent adapter must actually consume its recording through `input.replay`; merely finding a file is insufficient.

Plugins are trusted repository code, not sandboxed untrusted uploads. The runner blocks ordinary network APIs during offline execution; do not write a plugin that shells out or opens alternative network transports to evade that boundary.

## Ground truth and interpretation

[FORMAT.json](receipts/FORMAT.json) defines the label contract. All money uses integer minor units with exponent 2, including IDR. Rate strings are fractions (`"0.13"` means 13%). Null labels are unprinted/unverified and are excluded from that field's denominator, **not** treated as correct zeros. Verified empty discounts/taxes are meaningful expectations. Derived subtotals are not scored as printed-field extraction.

The scorer compares purchased items one-to-one without runtime UUIDs. Extra predictions, including negative coupons incorrectly emitted as purchased items, must not disappear. Compare raw line amounts to `linePrice`, never to tax-allocated `finalCents`. Item discounts and receipt-wide discounts are separate expectations; arithmetic gaps are not labelled discounts. Tax lines, receipt discounts and charges also score their aligned attributes independently: an existing label mismatch must not hide a newly wrong amount or rate. Collection-wide exact-match scores are supplementary, not the only regression check. Taxability has its own field/denominator and cannot be hidden by improvements in amounts. Existing files containing JSON `null` are malformed documents, never treated as missing files, even with `--allow-incomplete`.

The legacy labels deliberately allow partial/unknown fields and have `labelKind: "diagnostic-partial"`. They are separate from the strict image-corpus validator. Only 22 item descriptions verified verbatim against prior source annotations remain scoreable; 13 shortened/normalized descriptions are null, with their prior annotation text preserved in item notes. These are not everyday-name model labels. Two image-reviewed discount examples are 001 (item-owned discount 559 cents; rounding −1) and 525 (own discounts 257, 190 and 700 cents; rounding −2). Legacy taxability is unlabelled, so it contributes no taxability accuracy claim. The old pipeline preserves whole OCR rows in `originalText`, so low `items.description` accuracy is genuine old behavior rather than permission to substitute cleaner fields or model names.

## Validation without paid calls

```sh
python3 server/benchmark/validate_receipts.py
python3 -m unittest discover -s server/benchmark -p test_validate_receipts.py
corepack pnpm@12.3.4 --dir server exec node --import=tsx --test test/benchmark-scorer.test.ts test/benchmark-collections.test.ts test/benchmark.test.ts test/benchmark-record.test.ts test/benchmark-candidate.test.ts
corepack pnpm@12.3.4 --dir server typecheck
corepack pnpm@12.3.4 --dir server build
```

The Python validator checks all 24 release receipts and the (now empty) owner-slot count, exact minor-unit arithmetic, source/licence fields, image hashes, duplicate images, redaction bounds and PNG metadata absence. It cannot prove that visual redaction is complete or resolve legal rights; those require review. TypeScript tests exercise the actual CLI/report boundary, all 11 existing sanitized Azure fixtures, mocked three-configuration recording, frozen baseline parity, input drift, separate taxability, item insertion/removal, null coverage, observed fallback outcomes and regression exits. Synthetic full 20 × 3 tests prove harness mechanics only, not extraction quality. This includes the built-in default candidate gate, custom adapter override, model-missing coverage, exact serialized recorder/replay parity, post-filter recorded IDs, source-index gaps/duplicate descriptions, transient provenance, and zero-item no-call observations.

The integrated committed legacy run scores **223/284 → 227/284**, entirely from own-discount checks **10/14 → 14/14** (001 improves by one and 525 by three). Matching remains 35 matched / 0 missing / 0 extra. These legacy labels contain no scored taxability and are diagnostic-only; all **72 Azure recordings remain missing**, so the public release gate is **INCOMPLETE**, not a demonstrated no-regression release pass. Whole-row description, merchant, tax-mode and tax-line shortcomings remain visible in the report; do not hide them behind the discount improvement.

## Licence and privacy boundary

Keep `receipts/ATTRIBUTION.txt` and per-image manifests with redistributed images. Open Prices adaptations are CC BY-SA 4.0; CORD v2 is CC BY 4.0; ExpressExpense SRD has an explicit dataset-specific MIT image grant. Enterprise images were excluded pending clearer image rights. The three intended Superstore replacements are truthfully named Canadian grocers, not mislabelled as Superstore. See the dataset README for the dated source survey and CORD disclosure-discussion context.

Recorded raw OCR can repeat private information even when it is invisible in a summary. Use only redacted image inputs, and inspect every recording for personal identifiers before committing it. The 11 legacy analyses were sanitized in #48; no unredacted archive envelope or legacy source image is added here. Empty owner slots convey neither consent nor a licence; the owner supplies both in #50.

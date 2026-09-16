# AI and OCR for receipt line items

Researched on 2026-09-15 against official documentation, GitHub repositories, source files, and npm metadata. This is a source review, not a receipt accuracy benchmark or an implemented integration.

## Recommendation for ShareTally

Use Vercel AI SDK with a vision-capable model and your own provider API key for the first experiment. It fits the existing Node.js/Express and TypeScript backend without adding a Python service or another database. Define the receipt fields with a schema and show the extracted result as an editable draft.

If the priority is a ready-made receipt library, `receipt-ai-scanner` is the closest match found. Its API and item schema fit the request, but its validation defaults need extra application checks. I would compare it against the AI SDK approach before adopting it.

The current [project brief](../docs/project-brief.md), [ADR-0003](../docs/adr/0003-typescript-relational-backend.md), and [issue #1](https://github.com/SimianW/share-tally/issues/1) put manual expense sharing first. Receipt images, item claiming, and AI extraction are later additions. This note does not change that scope or approve automatic share allocation.

## What BYOK means here

The comparison assumes you supply a model provider key on your Express server. Friends use ShareTally, and usage is billed to that key. A separate feature where every friend supplies their own key would require account settings and secure credential handling; a library accepting `apiKey` does not provide that product workflow.

An open-source integration library does not make its cloud model open source or its API calls free. Fully local extraction is another option, with model hosting and hardware costs.

## Shortlist

Integration effort below is a judgment relative to this repository, not a measured delivery estimate.

| Project | License | BYOK and extraction | ShareTally fit |
| --- | --- | --- | --- |
| [Vercel AI SDK](https://github.com/vercel/ai) | Apache-2.0 | Direct provider keys; image input and schema-based structured output. You supply the receipt schema and prompt. | Best fit. TypeScript library inside Express; no separate extraction service required. |
| [receipt-ai-scanner](https://github.com/sahiljani/receipt-ai-scanner) | MIT | Receipt-specific TypeScript library. OpenAI, Anthropic, and OpenAI-compatible providers, including a documented Gemini configuration. Item description, quantity, unit price, total, and optional SKU/discount fields. | Closest ready-made library. Small project with validation caveats; prototype before adoption. |
| [ExtractThinker](https://github.com/enoch3712/ExtractThinker) | Apache-2.0 | Python extraction framework with Pydantic contracts, vision extraction, OCR loaders, provider integration, and local Ollama examples. You define an item-list contract. | Useful for broader document processing, but adds a Python boundary to this TypeScript app. |
| [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR) | Apache-2.0 for the project | Local OCR/document parsing. PP-ChatOCRv4 combines OCR and language models for field extraction with API key/base URL configuration. | Consider if local processing becomes a requirement. More runtime and model setup than a cloud vision call. |

Sources for licenses and capabilities are linked in the detailed notes below. Model weights and hosted services may have their own terms.

## AI SDK details

The [license file](https://github.com/vercel/ai/blob/main/LICENSE) specifies Apache-2.0. The [image-input example](https://ai-sdk.dev/cookbook/node/generate-text-with-image-prompt) demonstrates supplying images to vision-capable models. [Structured output documentation](https://ai-sdk.dev/docs/ai-sdk-core/generating-structured-data) describes `generateText` with `Output.object` and a Zod or JSON schema.

The [Google provider](https://ai-sdk.dev/providers/ai-sdk-providers/google-generative-ai) accepts an explicit `apiKey` or `GOOGLE_GENERATIVE_AI_API_KEY` and calls Google's API directly. This route does not require Vercel hosting or its AI Gateway. Gemini is a reasonable provider to test, not a claim that it is the most accurate or cheapest for these receipts.

The SDK provides the model call and schema validation. ShareTally still needs image upload handling, a receipt prompt, amount validation, error handling, and a correction screen. Schema validation checks the shape of the result; it cannot establish that a printed price was read correctly.

## receipt-ai-scanner details

The [README](https://github.com/sahiljani/receipt-ai-scanner#readme), [MIT license](https://github.com/sahiljani/receipt-ai-scanner/blob/main/LICENSE), [item types](https://github.com/sahiljani/receipt-ai-scanner/blob/main/src/types/receipt.ts), and [compatible-provider implementation](https://github.com/sahiljani/receipt-ai-scanner/blob/main/src/providers/openai-compatible.ts) confirm a receipt-specific library with configurable provider credentials and line-item output.

The [npm registry](https://registry.npmjs.org/receipt-ai-scanner/latest) returned version `1.2.0` and Node `>=20.0.0`. The README says Node 18, so use the package's actual engine requirement. [GitHub metadata](https://api.github.com/repos/sahiljani/receipt-ai-scanner) showed the repository was not archived, had zero stars, and was last pushed on 2026-04-14. Those observations establish limited visible adoption, not that the library is broken or abandoned.

Concrete source caveats:

- [Scanner defaults](https://github.com/sahiljani/receipt-ai-scanner/blob/main/src/scanner.ts) set `strictValidation` to `false`, `maxTokens` to `2048`, and `timeoutMs` to `0`. A long receipt needs a deliberate output budget and timeout.
- [Validation code](https://github.com/sahiljani/receipt-ai-scanner/blob/main/src/utils/validate.ts) defaults a missing total to zero and missing items to an empty array. Strict validation still uses that schema. Application checks must distinguish failed extraction from a real zero or empty result.
- The README identifies confidence as model-reported. It is not a calibrated probability that the prices are correct.
- Compatibility with a provider's API format is not proof that every model supports image input. Select and test a currently available vision model rather than copying an old example model name.

Use uploaded image bytes with this library and validate the result before presenting it as usable bill data. Its receipt-specific schema may save initial work, but retaining control of a smaller schema is why I prefer AI SDK here.

## Other options

[ExtractThinker's README](https://github.com/enoch3712/ExtractThinker#readme) shows custom contracts, `vision=True`, document loaders, and local model integration. Its [license](https://github.com/enoch3712/ExtractThinker/blob/main/LICENSE) is Apache-2.0. It is a framework for defining extraction, not an already verified Costco line-item parser. [Repository metadata](https://api.github.com/repos/enoch3712/ExtractThinker) showed its last push on 2025-08-27, so check dependency compatibility before choosing it. Exposing it to Express would require a Python service or process integration.

[PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR#readme) provides OCR and document parsing. Its [PP-ChatOCRv4 documentation](https://github.com/PaddlePaddle/PaddleOCR/blob/main/docs/version3.x/pipeline_usage/PP-ChatOCRv4.en.md) describes OCR plus model-based extraction, `key_list`, and model `api_key`/`base_url` configuration. Basic text recognition alone does not decide which price belongs to which item. Running the complete extraction workflow locally needs suitable models and hardware; neither was tested on the owner's server.

[Open Receipt OCR](https://github.com/iursevla/open-receipt-ocr) also surfaced as a self-hosted BYOK candidate. Its README documents a headless upload/status API, but responses contain provider-specific `ocrData`, including Markdown, rather than a guaranteed shared item schema. It adds NestJS, BullMQ, Redis, SQLite, and a worker. GitHub reported no detected license and a root `LICENSE` fetch returned 404 during this review. I could not establish an open-source license grant, so it is excluded from the open-source shortlist pending license clarification. See its [README](https://github.com/iursevla/open-receipt-ocr#readme) and [metadata](https://api.github.com/repos/iursevla/open-receipt-ocr).

## Proposed extraction workflow

This is a future design suggestion, not an approved endpoint or schema.

1. The initiator uploads a receipt photo to an authenticated Express endpoint.
2. Express sends the image to a vision model through the selected library, using a server-side key.
3. The model returns a draft with merchant, currency, raw item description, optional item number, nullable quantity and unit price, line amount, discounts, tax, and printed total. Unknown fields stay unknown rather than becoming invented values.
4. The server checks the draft's structure and amounts. Convert accepted monetary values to integer cents with deterministic decimal handling. Preserve higher precision where printed unit rates require it. Reconcile totals according to the receipt's discount convention so discounts are not counted twice.
5. The initiator compares the draft with the image and corrects it before saving. Extraction does not assign participant shares or confirm them.

Keep the printed description alongside any suggested expanded product name. Preserve separate discount rows and ambiguous associations. The [Costco importer project](https://github.com/garyhtou/costco-importer) documents separate discount lines that need association with purchased items, which is a useful test case for this app.

For a hosted model, receipt image content leaves the server for the selected provider. Keep provider secrets out of Vite frontend variables. Decide image retention when designing uploads, and apply file limits, request timeouts, and usage limits to the extraction endpoint.

## Small evaluation before adoption

Try the same 10 to 20 representative Costco and other shopping receipts through AI SDK and the receipt library. Include long receipts, faded text, skewed photos, repeated products, multiple quantities, weighted goods, coupons, and separate tax lines. Prepare manually checked expected items first.

Measure exact line-amount matches, missing/extra items, correct discount associations, printed-total matches, correction time, response latency, and actual API usage cost. A matching grand total alone is insufficient because item errors can offset each other. Do not use the model's own confidence as the pass criterion.

No paid model calls, package installation, receipt benchmark, or application changes were performed for this research. Accuracy, latency, cost per receipt, and local hardware suitability remain unmeasured.

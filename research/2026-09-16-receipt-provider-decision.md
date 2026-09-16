# Receipt extraction and product-name interpretation

Status on 2026-09-16: implementation paused at the owner's request while evaluating Azure Document Intelligence. Existing work remains on `feat/receipt-item-claiming`; it is incomplete and has not been deployed.

## Confirmed preference

The owner selected `gpt-5.6-luna` for converting raw receipt descriptions into short plain-English product names. Keep original descriptions. Name interpretation must not change quantities, amounts, taxes or claims. Return `Unclear Item` when the description does not establish the product.

The official [GPT-5.6 Luna model page](https://developers.openai.com/api/docs/models/gpt-5.6-luna), fetched on 2026-09-16, lists structured outputs and the model ID `gpt-5.6-luna`. Its displayed text price is USD 0.20 per million input tokens and USD 1.20 per million output tokens. This verifies a documented model, not access from the owner's API project. [Official pricing](https://developers.openai.com/api/docs/pricing) distinguishes processing tiers and long-context prices.

A hypothetical text-only name request using 1,000 input tokens and 500 total billable output tokens costs USD 0.0008 at those rates. Actual output, including reasoning, and selected service tier determine the bill. No paid calls were made.

## Extraction candidate, not a benchmark winner

Azure's `prebuilt-receipt` model is under evaluation as the replacement for Gemini extraction. Its [2024-11-30 official receipt schema](https://github.com/Azure-Samples/document-intelligence-code-samples/blob/main/schema/2024-11-30-ga/receipt.md) includes item description, quantity, unit price, total price, product code and quantity unit, plus receipt-level tax details. The documented retail item schema does not include dedicated per-item tax or discount fields. Plain-English product interpretation is a separate requirement.

The existing `demo/receipt-extraction` comparison tested two integrations using Gemini 2.5 Flash, not Azure. Its 11 public scans are Malaysian and Moroccan SROIE samples, not a Canadian Costco benchmark. It cannot establish which provider is best for the owner's actual purchases.

Recommended next evaluation: reuse the labeled 11 samples for continuity and add representative Canadian shopping receipts with mixed taxability, separate coupons, repeated items, quantities and faded print. Compare missing/extra items, exact amounts, discount association, correction time, latency and actual cost. Do not silently use a language model to replace Azure-extracted amounts.

## Proposed application configuration

If Azure is selected, use server-only `AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT` and `AZURE_DOCUMENT_INTELLIGENCE_KEY` for extraction, and `OPENAI_API_KEY` plus `RECEIPT_NAME_MODEL=gpt-5.6-luna` for names. These are proposed application settings, not currently implemented configuration. Do not add keys to client-side `VITE_*` variables. No credentials are required to finish the source review.

## Development provider update

The owner selected `http://dev-2a1m:8317/` for development model calls. A read-only probe returned the CLI Proxy API Server endpoints `POST /v1/chat/completions`, `POST /v1/completions` and `GET /v1/models`. The models endpoint returned HTTP 401, `Missing API key`; model availability and a real generation have not been verified.

The isolated name interpreter in `server/src/receipt-names.ts` uses the Responses API with medium reasoning. The model remains selected by `RECEIPT_NAME_MODEL`; it is not fixed in the request code. Custom gateways do not fall back to an OpenAI production key. Tests use a mocked HTTP response and verify the Responses payload, item identity, order, strict output and exclusion of financial fields.

This module is not yet wired into the paused receipt extraction flow. Azure integration and the full OCR feature remain unfinished; no provider switch has been deployed.


## Accepted follow-up decisions

The owner subsequently selected Azure for item/amount extraction and GPT-5.6 Luna for names, informed by the comparison recorded on branch `demo/azure-receipt-comparison`. The owner also accepted manual receipt-wide/per-item discount entry, an editable tax-inclusion setting that prevents double tax, nonblocking Luna failure with original-text fallback, and empty required monetary fields that must be filled before Initiate. Review happens within the bill form, not in a separate approval step. Issue #26 is the canonical specification; these research notes are supporting evidence. The full implementation remains paused and incomplete.

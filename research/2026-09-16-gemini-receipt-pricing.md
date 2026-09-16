# Gemini API pricing for receipt OCR

Researched on 2026-09-16 against Google's Gemini Developer API documentation. Prices and quotas can change; the linked official pages are the source of truth for implementation and billing decisions.

## Recommendation

Use the standard Gemini Developer API with `gemini-2.5-flash` through the existing `@ai-sdk/google` provider. The model accepts images and returns text, supports structured outputs, and supports thinking. This is a good fit for sending one cropped receipt image and receiving a validated item list. The model page documents a 1,048,576-token input limit and a 65,536-token output limit. [Gemini 2.5 Flash model page](https://ai.google.dev/gemini-api/docs/models/gemini-2.5-flash)

## Current price

Google lists the following standard prices in USD per 1 million tokens for `gemini-2.5-flash`:

| Usage | Free tier | Paid standard tier |
| --- | --- | --- |
| Input: text, image, or video | Free of charge | $0.30 |
| Output, including thinking tokens | Free of charge | $2.50 |
| Context cache input: text, image, or video | Not available | $0.03 |
| Context-cache storage | Not available | $1.00 per 1M tokens per hour |

The same pricing page lists a cheaper Batch option: $0.15 per 1M input tokens and $1.25 per 1M output tokens (including thinking), with no free tier. Batch is asynchronous and is not needed for the interactive receipt flow. [Gemini Developer API pricing](https://ai.google.dev/gemini-api/docs/pricing#gemini-2.5-flash)

The free tier is available to new accounts and active projects or free trials, subject to each model's free-tier rate limits. The paid tier requires linking a billing account; Google's billing guide currently says that upgrading requires a minimum $5 (or equivalent) prepayment. Paid access provides higher rate limits and keeps prompts and responses out of Google's product-improvement use under the paid-service terms. [Billing and tiers](https://ai.google.dev/gemini-api/docs/billing#about-billing) · [Set up paid billing](https://ai.google.dev/gemini-api/docs/billing#setup-billing)

The pricing page also says Google AI Studio usage is free of charge in available regions. That does not mean an unrestricted production API endpoint: the API still has free-tier model and rate-limit conditions. [Pricing notes](https://ai.google.dev/gemini-api/docs/pricing#notes)

## How a receipt image is charged

Gemini converts an image into input tokens. Google documents these rules:

- If both image dimensions are at most 384 pixels, the image costs 258 input tokens.
- Larger images are divided into 768×768 tiles, each costing 258 input tokens.
- Google gives a rough crop-unit formula and uses a 960×540 image as an example: six tiles, or 1,548 image tokens.
- Supported image MIME types include PNG, JPEG, WEBP, HEIC, and HEIF.

The image tokens are charged at the model's input price for text/image/video; there is no separate receipt-image line item. Clear, correctly rotated images and a prompt placed before the image are recommended for text in an image. [Image understanding and token calculation](https://ai.google.dev/gemini-api/docs/image-understanding#token_calculation)

### Hypothetical per-receipt cost

This is an estimate, not a measured call. Assume one 960×540 receipt image (1,548 image tokens), a 300-token extraction instruction, and a 700-token response containing the structured receipt data. At the paid standard price:

```text
input  = (1,548 + 300) / 1,000,000 × $0.30 = $0.0005544
output = 700 / 1,000,000 × $2.50              = $0.0017500
total                                             $0.0023044
```

That is approximately $0.0023 USD for this assumed call. If the model generated a further 1,000 thinking tokens, the billable output would be 1,700 tokens and the same call would cost approximately $0.0048 USD. Google says response pricing when thinking is enabled is the sum of visible output and thinking tokens; the pricing table's output price already includes both. [Thinking and pricing](https://ai.google.dev/gemini-api/docs/thinking#pricing)

Actual cost depends on image dimensions, prompt length, output length, thinking configuration, retries, and whether a request is made on the free or paid tier. Use the API response usage metadata to measure real extraction calls before setting product limits.

## API key creation and application configuration

Create or manage the key in [Google AI Studio API Keys](https://aistudio.google.com/apikey) (the [API Keys page](https://aistudio.google.com/api-keys) is also linked from Google's docs). Each key is associated with a Google Cloud project, which owns the billing and quota relationship. New AI Studio keys are currently created as authorization keys by default; follow Google's migration notices when managing older standard keys. [Using Gemini API keys](https://ai.google.dev/gemini-api/docs/api-key)

Google's own Gemini client libraries recognize `GEMINI_API_KEY` or `GOOGLE_API_KEY`, with `GOOGLE_API_KEY` taking precedence. The ShareTally implementation uses `@ai-sdk/google`, whose documented provider variable is `GOOGLE_GENERATIVE_AI_API_KEY`. [AI SDK Google provider](https://ai-sdk.dev/providers/ai-sdk-providers/google-generative-ai) · [Google environment-variable setup](https://ai.google.dev/gemini-api/docs/api-key#setup-environment)

For this repository, the secret belongs on the API server:

- Local development: add `GOOGLE_GENERATIVE_AI_API_KEY=...` to `server/.env`; `server/package.json` loads that file for `dev` and `start`.
- Production: add the same variable to the deployment host's `deploy/.env.production`; `deploy/compose.yml` passes that file only to the `api` service. Add the variable name (without a real value) to [`deploy/.env.production.example`](../deploy/.env.production.example) when implementation configuration is updated.

Do not put the key in `client/.env`, `VITE_*` variables, browser code, source control, or receipt responses. The extraction request should go from the authenticated server to Gemini. Google's key guide treats API keys like passwords and recommends environment variables, restrictions, and never exposing production keys client-side. [API key security](https://ai.google.dev/gemini-api/docs/api-key#security)

## Limits that affect this feature

Gemini supports up to 3,600 image files in one request, so ShareTally's one-image-per-bill rule is comfortably within the model's file limit. The practical limits for a receipt flow are request size, image resolution, free-tier rate limits, output budget, and server-side timeouts. The image guide notes that higher-resolution inputs improve small-text reading while increasing token usage and latency. [Image understanding](https://ai.google.dev/gemini-api/docs/image-understanding#file_limit)

No paid Gemini calls were made during this research. The per-receipt numbers above are arithmetic examples based on Google's published token rates, not an invoice or accuracy benchmark.

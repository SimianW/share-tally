# Azure Document Intelligence for receipt OCR

Researched on 2026-09-16 against Microsoft Learn, Azure's official pricing page, Microsoft's Azure product availability data, and the official Azure sample schema. This is a source review; no Azure resource was created and no paid request was made.

## Decision-relevant conclusion

Azure Document Intelligence is a strong first choice for the receipt-to-structured-data part of ShareTally. Its current `prebuilt-receipt` model (API `2024-11-30`, v4.0 GA) is designed for receipts and returns typed, structured fields. It has first-class line items with descriptions, quantities, unit prices, and line totals, plus subtotal, total tax, tax details, payments, and the transaction total.

It is not a complete replacement for the planned workflow. The official receipt schema has no standard per-item tax or discount field. The application would need to apply the agreed allocation rule for a receipt-level tax and discounts, then let the Initiator edit the resulting item totals. Azure also does not translate cryptic product descriptions into plain English; that remains a separate application/model step. Therefore the recommended architecture is:

1. Use Azure `prebuilt-receipt` as the deterministic receipt/OCR extractor.
2. Preserve Azure's raw content and field values for the raw view and correction screen.
3. Keep a separate plain-English naming step, with `Unclear Item` as the fallback.
4. Let the Initiator verify and edit all extracted and allocated amounts before initialization.

This is a better fit than asking a general vision model to infer the entire receipt schema, but the project should still benchmark it against representative Canadian receipts before calling it the most accurate option. The existing experiment's public sample set is Malaysian/Moroccan SROIE data, not Canadian Costco or other local receipts, so its result cannot establish Canadian accuracy.

## What Azure returns

The current model identifier is `prebuilt-receipt`. For a normal retail, meal, parking, or similar thermal receipt, the schema includes:

| Receipt data | Available field(s) | Implication for ShareTally |
| --- | --- | --- |
| Merchant and transaction | `MerchantName`, `MerchantPhoneNumber`, `MerchantAddress`, `TransactionDate`, `TransactionTime`, `CountryRegion`, `ReceiptType` | Useful metadata for the draft; not needed for claiming. |
| Totals | `Subtotal`, `TotalTax`, `Total`, `Tip` | Provides the Initiator's expected total and receipt-level tax. |
| Line items | `Items[].Description`, `Quantity`, `Price`, `TotalPrice`, `ProductCode`, `QuantityUnit` | Directly supports the OCR item list and fraction claims. |
| Tax details | `TaxDetails[].Description`, `Rate`, `NetAmount`, `Amount` | Supports receipt-level tax allocation, but does not identify a tax amount for each `Items[]` entry. |
| Payment | `Payments[].Method`, `Payments[].Amount` | Can help compare the printed paid amount with `Total`. |

Each extracted field is returned with typed data and a confidence value in the SDK's `DocumentField` representation. The confidence is useful for highlighting fields for review; it is not proof that the printed value is correct. Microsoft's receipt quickstart prints confidence for item descriptions, item amounts, subtotal, and total tax.

The official schema shows no `Items[].Tax`, `Items[].Discount`, or item-to-tax association. The product page's mention of `TaxDetails` means tax categories/details, not a guaranteed per-line tax breakdown. Discounts are also not a standard receipt-model field. For this project, receipt-level amounts should be allocated according to the approved rule and remain editable by the Initiator.

Sources: [receipt model documentation](https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/prebuilt/receipt?view=doc-intel-4.0.0), [2024-11-30 receipt schema](https://raw.githubusercontent.com/Azure-Samples/document-intelligence-code-samples/main/schema/2024-11-30-ga/receipt.md), and [Microsoft JavaScript/.NET quickstart examples showing field confidence](https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/quickstarts/get-started-sdks-rest-api?view=doc-intel-4.0.0&preserve-view=true&tabs=javascript).

## Languages and Canadian receipts

For v4.0 thermal receipts, Microsoft's schema lists English (`en`) and French (`fr`) among the supported languages, along with a broad multilingual list. The current v4 table does not promise a special `en-CA` receipt locale; the older v2.1 table listed English Canada separately. This means Canadian English and French text are in scope at the language level, but the docs do not guarantee accuracy for Canadian merchants, layouts, tax conventions, or currencies.

Azure's product availability data currently lists Azure AI Document Intelligence as GA in Canada Central. A Canada Central resource is therefore a reasonable default for this Canadian application, subject to the subscription's available SKUs and current Azure availability.

Sources: [prebuilt-model language table](https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/language-support/prebuilt?view=doc-intel-4.0.0) and [official Azure products-by-region data](https://azure.microsoft.com/en-us/explore/global-infrastructure/products-by-region/table).

## Current pricing

The official Azure pricing page retrieved on 2026-09-16 lists the following Pay-As-You-Go values. The page exposes prices as dynamic region/currency data. In the raw response, the `canada-central` USD data for the prebuilt row is `10.0` per 1,000 pages; however, the server-rendered price label in this fetch was `$-`, so this is a verified published-page data value rather than an independently confirmed account quote.

| Tier or operation | Official price at retrieval | Practical meaning |
| --- | --- | --- |
| F0 free tier | 500 pages free per month (visible on the official page) | Enough for a small trial. The quickstart also describes F0 as the free tier for trying the service. |
| S0, all prebuilt models, including Receipt | **$10 per 1,000 pages in the page's Canada Central USD metadata; visible label was `$-` in this fetch** | Approximately **$0.01 per analyzed receipt page if that published metadata is the applicable rate**, before currency conversion, tax, retries, or other Azure charges. |
| S0 Read, 0–1M pages | $1.50 per 1,000 pages in page metadata; visible label was `$-` | Not the receipt prebuilt operation; relevant only if the app separately calls Read. |
| S0 Read, 1M+ pages | $0.60 per 1,000 pages in page metadata; visible label was `$-` | Same caveat. |

For this feature, one cropped JPEG/PNG receipt is normally one page, so the receipt model's base processing is roughly one cent per image at the listed USD price. Every retry or replacement analysis is another page analyzed. The $10 prebuilt price already covers the receipt model; the separate Read price should not be added unless the implementation invokes Read too. A separate plain-English model call, image storage, bandwidth, and application hosting are outside this Azure receipt price.

The pricing page states that prices are estimates, based on US dollars, and may vary by agreement, purchase date, region, currency exchange rate, and taxes. Because this retrieval's rendered paid-price labels were `$-`, confirm the applicable rate in the [Azure pricing page](https://azure.microsoft.com/en-us/pricing/details/document-intelligence/) or [Azure pricing calculator](https://azure.microsoft.com/en-us/pricing/calculator/?service=form-recognizer) for the account's actual offer before budgeting. Azure says Document Intelligence has no monthly/yearly subscription; commitment pricing is available for high-volume workloads.

The free tier has important upload limits: the current receipt documentation lists a 4 MB maximum file size for F0 versus 500 MB for S0, image dimensions from 50×50 to 10,000×10,000 pixels, and only the first two pages of a PDF/TIFF in the free tier. The planned one-photo JPEG/PNG workflow fits the page limit, but the client or server should resize/reject oversized images before submission.

Sources: [official Document Intelligence pricing page](https://azure.microsoft.com/en-us/pricing/details/document-intelligence/) (Pay-As-You-Go table and FAQ), [receipt input limits](https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/prebuilt/receipt?view=doc-intel-4.0.0), and [quickstart F0 guidance](https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/quickstarts/get-started-sdks-rest-api?view=doc-intel-4.0.0&preserve-view=true&tabs=javascript).

## Endpoint, key, and request shape

Create a single-service Document Intelligence resource in the Azure portal, choose the Canada Central region if available, and retrieve its endpoint and key from **Azure portal → resource → Keys and Endpoint**. Microsoft recommends a single-service resource when only Document Intelligence is needed; a Foundry multi-service resource is an option when several Foundry Tools share one endpoint/key. The free `F0` tier can be selected for testing and upgraded to `S0` later.

The v4 REST request is:

```text
POST {endpoint}/documentintelligence/documentModels/prebuilt-receipt:analyze?_overload=analyzeDocument&api-version=2024-11-30
Ocp-Apim-Subscription-Key: {key}
Content-Type: application/json
```

The body can contain either `base64Source` for image bytes or `urlSource` for a document URL. The API is asynchronous: submit the analysis, poll the operation/result, then persist the fields needed by the bill draft. The backend should make this request; the browser must never receive the Azure subscription key.

The generated REST reference documents the endpoint, `prebuilt-receipt` model ID, `2024-11-30` API version, `Ocp-Apim-Subscription-Key` authentication, `base64Source`/`urlSource`, and an optional `pages` parameter. Microsoft marks v4.0 (`2024-11-30`) as the current GA version and recommends it for new development.

Sources: [Document Intelligence receipt setup](https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/prebuilt/receipt?view=doc-intel-4.0.0), [v4 REST Analyze Document reference](https://learn.microsoft.com/en-us/rest/api/aiservices/document-models/analyze-document?view=rest-aiservices-v4.0%20(2024-11-30)&tabs=HTTP), and [v4 quickstart prerequisites](https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/quickstarts/get-started-sdks-rest-api?view=doc-intel-4.0.0&preserve-view=true&tabs=javascript).

## Privacy and the six-month product photo

Azure processes incoming data in the same region where the Document Intelligence resource was created. During asynchronous processing, submitted input and analysis results are temporarily encrypted and stored in Azure Storage in that region, with logical isolation by subscription and credentials. Microsoft states that the submitted input and analyze result are automatically deleted 24 hours after the analysis operation completes; the Delete Analyze Result API can delete them earlier.

That 24-hour Azure result retention is separate from ShareTally's product requirement to show the cropped receipt to group members for six months. If the product needs the photo for six months, ShareTally must save its own cropped image in its application storage and delete that object after six months. Persist the corrected item data and OCR raw text separately from Azure's temporary analysis result. The draft remains Initiator-only in ShareTally; after initialization the saved photo can be visible to all members of the group as specified by the product.

Sources: [Microsoft's Document Intelligence data, privacy, and security documentation](https://learn.microsoft.com/en-us/azure/foundry/responsible-ai/document-intelligence/data-privacy-security) and [Delete Analyze Result REST reference](https://learn.microsoft.com/en-us/rest/api/aiservices/document-models/delete-analyze-result?view=rest-aiservices-v4.0%20(2024-11-30)&tabs=HTTP).

## Recommendation for the implementation branch

Adopt Azure for receipt extraction behind the existing backend route, using `prebuilt-receipt` v4.0 and a server-side endpoint/key. Keep the current two bill modes unchanged. In OCR mode, map Azure `Items[]` to editable draft items, preserve the original `Description` and the field content/bounding data needed for the raw view, calculate the agreed receipt-level tax allocation, and expose all resulting values to Initiator correction. Run a separate plain-English naming pass only for the display name; when it cannot identify the item, use `Unclear Item` and retain the original description.

Before declaring Azure the accuracy winner, run the same manually labeled set through Azure and the existing Gemini vision experiment. Include Canadian English/French receipts, long and skewed photos, repeated products, quantities, weighted goods, coupons/discount lines, GST/HST/PST/QST combinations, and receipts where the total tax is only printed once. Measure missing/extra lines, line-total accuracy, quantity/unit-price accuracy, grand-total accuracy, correction time, latency, retries, and actual cost. A correct grand total alone can hide offsetting item errors.

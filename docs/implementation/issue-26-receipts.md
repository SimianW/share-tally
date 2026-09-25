# Receipt drafts and item claims

Implementation lives on `feat/receipt-item-claiming-v2`. Issue #26 remains the requirements record.

## User flow

The owner selected prototype A on 2026-09-16: one draft form with three navigable steps (receipt input, item editing, sharing and paid total). The selected flow replaces the initial long form. Step changes retain edits; saving and reopening in the same browser session restores the step. Other sessions infer a useful step from the saved content. Only the final step can initiate; receipt extraction never submits the bill. Manual fallback, zero-priced items and initiator adjustments remain supported without a new exact-total or approval gate.

The three original designs and their runnable snapshot are archived on [`demo/new-bill-layouts`](https://github.com/SimianW/share-tally/tree/demo/new-bill-layouts), commit `408dcba78b005e43c19d607729883ab359cf6f44`. Run `cd client && pnpm prototype:new-bill`, then open `/?variant=A#/prototype/new-bill`. The implementation branch contains only the selected flow, with no prototype routes or switcher.

New bill offers the existing manual workflow and receipt/item entry. Receipt drafts save to the server and stay private to their initiator. The group page lists resumable drafts. Camera and file inputs share a crop editor; only the cropped JPEG is uploaded. Scanning replaces edited items only after an explicit replacement action.

Receipt reading now follows #47/#51 and ADR-0011. Azure Document Intelligence alone supplies amounts. The scan saves the Azure result and raw evidence, increments the revision, and returns a processing draft. One background model call receives structured receipt evidence without the photo and returns only names and taxability (with item IDs for correlation). Printed codes and legends are evidence for the model, not deterministic overrides. The selected Azure receipt schema has no per-item taxable field. Schema reference: https://github.com/Azure-Samples/document-intelligence-code-samples/blob/main/schema/2024-11-30-ga/receipt.md.

A processing draft is read-only, including photo changes and initiation; other bills remain available. Completion increments the revision and emits the existing group `changed` event. Timeout, errors, unusable results and missing item answers retain affected Azure names, default those items to taxable and set `taxNotChecked`; the draft status becomes `fallback` whenever any item was unchecked. Recovery runs at startup, periodically, and on draft reads. Once processing ends these hints do not block initiation. Name retries are removed: the background stage makes one call with no retry. The checkbox changes allocation eligibility on the next Apply adjustments action.

Receipt tax, discount and other charges are separate from item-specific amounts. Recalculation uses largest remainders with item order breaking ties. The tax-inclusion setting excludes receipt and item tax from added costs. Explicit final-cost corrections take precedence. Missing prices and totals stay null until entered. Initialization validates prices, final costs, participants and paid total again on the server.

Initiation publishes the bill but confirms no item claims. Participants submit exact whole or fractional claims and explicitly confirm no purchases when appropriate. Claims, price changes, participant edits and completion lock the bill row in PostgreSQL. Fractions use BigInt arithmetic; rounding occurs once per participant after summing all fractional costs. Completion applies the paid-total difference to the initiator and rejects a negative effective initiator cost.

## Photos and deployment

A bill has one photo. The server strips metadata and normalizes uploaded image bytes with Sharp. Draft photos require the initiator's identity; initialized photos require group membership. Access expires six calendar months after upload. Startup and hourly cleanup erase the stored bytes, retaining expiry metadata and all accounting data.

`deploy/nginx.conf` permits 12 MB JSON uploads and waits 180 seconds for extraction. The image limit is 8 MB before server normalization; supported formats are JPEG, PNG and WebP. Azure requests have a 120-second timeout. The background name/tax request has a 40-second timeout and is not retried. Scan logs contain Azure submit, poll, mapping and model durations plus the outcome, never receipt contents. `deploy/.env.production.example` lists the required provider settings. Credentials remain server-side. The development gateway must receive its own key rather than an implicit production OpenAI key.

The in-memory provider request limit applies per authenticated user per server process and resets on restart. It is a local cost guard, not a persistent or distributed quota.

The backup command in `issue-8-attention-and-trial.md` excludes receipt photo bytes. Do not enable receipt uploads in production with a backup or snapshot policy that retains those bytes after expiry. Restoring the documented backup restores accounting data without receipt photos. Production provider reachability, reverse proxies outside this repository and the backup schedule still need deployment verification.

## Verification

- `cd server && pnpm typecheck && pnpm test` runs the HTTP suite against isolated PostgreSQL containers and provider unit tests. No paid provider calls are required.
- `cd client && pnpm build && pnpm lint` checks the UI.
- `cd client && pnpm test:receipts` runs the actual UI, Express and isolated PostgreSQL with only authentication and receipt providers replaced. It uses a non-loopback HTTP origin to catch browser APIs restricted to secure contexts, including UUID generation. It covers guided navigation, final-step-only submission, manual fallback, zero-priced items, draft recovery, crop/upload, extraction failure/retry, tax inclusion, discounts, manual cost overrides, three fractional claimants, reservations, reconfirmation, completion, a lost initialization response and mobile overflow checks.
- `cd client && pnpm test:groups` retains the existing manual bill and repayment browser checks.

One real call through the new Azure extraction adapter and the configured Luna gateway succeeded on the existing public receipt `000.jpg`. Azure returned one item and a total of 900 minor units in MYR; naming preserved the financial data. This verifies the provider wiring, not Canadian receipt accuracy or currency conversion. Non-CAD receipts display a warning and are never converted automatically.

Screenshots from browser checks are written to `/tmp/share-tally-receipt-smoke/`. Real Google sign-in, a physical mobile camera capture, deployment backup/restore and the owner-plus-two-friends trial remain release checks. No production deployment was performed in this implementation session.

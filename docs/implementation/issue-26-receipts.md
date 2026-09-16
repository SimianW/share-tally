# Receipt drafts and item claims

Implementation lives on `feat/receipt-item-claiming-v2`. Issue #26 remains the requirements record.

## User flow

New bill offers the existing manual workflow and receipt/item entry. Receipt drafts save to the server and stay private to their initiator. The group page lists resumable drafts. Camera and file inputs share a crop editor; only the cropped JPEG is uploaded. Scanning replaces edited items only after an explicit replacement action.

Azure Document Intelligence reads items and receipt totals. A separate request sends only item IDs and original descriptions to the configured Luna name service. Name failure preserves the receipt and permits initiation. A late name response changes only names that the user has not edited. It never merges provider amounts into the draft.

Receipt tax, discount and other charges are separate from item-specific amounts. Recalculation uses largest remainders with item order breaking ties. The tax-inclusion setting excludes receipt and item tax from added costs. Explicit final-cost corrections take precedence. Missing prices and totals stay null until entered. Initialization validates prices, final costs, participants and paid total again on the server.

Initiation publishes the bill but confirms no item claims. Participants submit exact whole or fractional claims and explicitly confirm no purchases when appropriate. Claims, price changes, participant edits and completion lock the bill row in PostgreSQL. Fractions use BigInt arithmetic; rounding occurs once per participant after summing all fractional costs. Completion applies the paid-total difference to the initiator and rejects a negative effective initiator cost.

## Photos and deployment

A bill has one photo. The server strips metadata and normalizes uploaded image bytes with Sharp. Draft photos require the initiator's identity; initialized photos require group membership. Access expires six calendar months after upload. Startup and hourly cleanup erase the stored bytes, retaining expiry metadata and all accounting data.

`deploy/nginx.conf` permits 12 MB JSON uploads and waits 150 seconds for extraction. The image limit is 8 MB before server normalization; supported formats are JPEG, PNG and WebP. Azure requests have a 120-second timeout and name requests have a 30-second timeout. `deploy/.env.production.example` lists the required provider settings. Credentials remain server-side. The development gateway must receive its own key rather than an implicit production OpenAI key.

The in-memory provider request limit applies per authenticated user per server process and resets on restart. It is a local cost guard, not a persistent or distributed quota.

The backup command in `issue-8-attention-and-trial.md` excludes receipt photo bytes. Do not enable receipt uploads in production with a backup or snapshot policy that retains those bytes after expiry. Restoring the documented backup restores accounting data without receipt photos. Production provider reachability, reverse proxies outside this repository and the backup schedule still need deployment verification.

## Verification

- `cd server && pnpm typecheck && pnpm test` runs the HTTP suite against isolated PostgreSQL containers and provider unit tests. No paid provider calls are required.
- `cd client && pnpm build && pnpm lint` checks the UI.
- `cd client && pnpm test:receipts` runs the actual UI, Express and isolated PostgreSQL with only authentication and receipt providers replaced. It uses a non-loopback HTTP origin to catch browser APIs restricted to secure contexts, including UUID generation. It covers draft recovery, crop/upload, extraction failure/retry, tax inclusion, discounts, manual cost overrides, three fractional claimants, reservations, reconfirmation, completion, a lost initialization response and mobile overflow checks.
- `cd client && pnpm test:groups` retains the existing manual bill and repayment browser checks.

One real call through the new Azure extraction adapter and the configured Luna gateway succeeded on the existing public receipt `000.jpg`. Azure returned one item and a total of 900 minor units in MYR; naming preserved the financial data. This verifies the provider wiring, not Canadian receipt accuracy or currency conversion. Non-CAD receipts display a warning and are never converted automatically.

Screenshots from browser checks are written to `/tmp/share-tally-receipt-smoke/`. Real Google sign-in, a physical mobile camera capture, deployment backup/restore and the owner-plus-two-friends trial remain release checks. No production deployment was performed in this implementation session.

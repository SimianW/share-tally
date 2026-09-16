# Draft list prototype

Question: where should private drafts and their delete actions appear on the group bills page?

Three in-memory variants using the existing app typography, colors, Button and Dialog components. A sample group shell replaces authentication and network requests so no real drafts can change. The simplified editor demonstrates save/discard semantics; it does not replace the production New bill wizard.

Run `cd client && pnpm install && pnpm prototype:drafts`, then open:

- http://dev-2a1m:5178/?variant=A#/prototype/drafts — compact rows with direct delete actions
- http://dev-2a1m:5178/?variant=B#/prototype/drafts — cards with an overflow delete action
- http://dev-2a1m:5178/?variant=C#/prototype/drafts — summary and management drawer

The floating switcher and left/right arrow keys cycle variants. Reset restores fixtures; State displays saved records and the current edit buffer. State is not persisted. The prototype entry point is development-only.

All variants support delete confirmation, keep draft, continuing a saved draft, explicit save, and unsaved-change confirmation on close. Discard preserves the previous saved version. New blank drafts close without saving. Uploaded images are represented by fixture metadata only.

Related requirements: GitHub issue #26; follow-up user request on 2026-09-16 to unify New bill entry, make draft saves explicit, and add deletion. This artifact explores the draft list only. The owner selected A on 2026-09-16. The chosen layout keeps Continue and delete directly visible on compact rows. Production implementation lives on feat/explicit-drafts; the other variants remain here as design evidence.

Verified: client TypeScript; browser checks at 390px for A/B/C, delete dialogs, save and discard behavior; no browser exceptions. Production persistence/API changes are not implemented by this prototype.

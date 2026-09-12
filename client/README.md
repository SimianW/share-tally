# ShareTally UI demos

Three homepage designs for the same group-expense app, built in React and TypeScript. The default route opens the demo without a Clerk key or a running backend.

```bash
cd client
pnpm install --frozen-lockfile
pnpm dev
```

Open the local URL printed by Vite. If port 5173 is already in use, run `pnpm dev --port 5174`.

| Design | Direct route      | Direction                                                                                            |
| ------ | ----------------- | ---------------------------------------------------------------------------------------------------- |
| Play   | `/?design=play`   | Rounded typography, lime green, tactile buttons, a balance receipt, and pastel group cards.          |
| Gather | `/?design=gather` | Cream paper, serif headings, terracotta accents, horizontal navigation, and a shared ledger.         |
| Orbit  | `/?design=orbit`  | Dark surfaces, lime highlights, a narrow navigation rail, balance metrics, and compact group panels. |

Use the top switcher to compare designs without losing data. Mobile layouts use bottom navigation. The settings button in the top bar opens the demo settings and reset control.

## Interactions

- Create a bill in a group, select its participants, and enter the total and your own share, including an explicit zero share. You are always included as the initiator; other group members start unchecked. Select all and invert selection affect only the other members. Changing groups clears those selections.
- Create a group with a name, icon, and selected sample members.
- Open groups and bills, filter recent bills, and view the activity feed.
- Confirm your share of the seeded Costco bill. Its other participants have confirmed $140.40; submitting $46.80 completes the $187.20 bill.
- View group balances and confirm the sample $24.50 incoming repayment from Jamie.
- Reset the sample records in demo settings.

Data lives in `localStorage` under `sharetally.demo.v1`, with payload version 2. Existing version 1 records migrate without clearing your demo: older bills keep all their group members as participants, matching their original behavior. New bills save their selected participants separately, and bill details display that saved list. The selected design uses `sharetally.design`; the URL selection takes precedence. Invalid saved data falls back to the sample records. If browser storage is unavailable, the demo works in memory and reports that changes will not survive refresh.

These are UI fixtures, not the production accounting workflows. New shared bills include only the selected group members and remain pending until their shares are available. A bill with only you selected requires your share to equal the full total and completes immediately. People must join a group before they can participate in its bills. The demo does not impersonate other participants, calculate repayment instructions, start real settlements, send invitations, or move money. The incoming repayment is a separate sample of the recipient confirmation screen. The actual schema, authorization, share-revision rules, and settlement workflow remain future implementation work.

## Source

- `src/demo/DemoApp.tsx`: design selection, navigation, and local mutations.
- `src/demo/Homepages.tsx`: the three separate homepage compositions.
- `src/demo/Dialogs.tsx`: native dialogs and local forms.
- `src/demo/ui.tsx`: shared icons, group cards, bill rows, and activity feed.
- `src/demo/data.ts`: sample records, cache validation, and display amounts.
- `src/demo/demo.css`, `themes.css`, `responsive.css`: shared styles, alternate designs, and responsive layouts.

The existing Clerk screen is preserved at `/auth` and still needs `VITE_CLERK_PUBLISHABLE_KEY` in `.env.local`. It is loaded separately from the demo. Fonts are served locally; their licenses are in `public/fonts/`.

```bash
pnpm build
pnpm lint
```

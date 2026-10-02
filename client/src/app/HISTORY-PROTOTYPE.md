# Canceled history prototype

Throwaway UI exploration, kept on `prototype/canceled-history` rather than main.

## Question and verdict

How should group members reveal canceled bills when history hides them by default?

The owner selected **A, Header button**, on 2026-10-02. Keep the existing history rows and add a small Show canceled button beside the heading. Its count makes the hidden records discoverable. Clicking it includes canceled bills in their original order; clicking Hide canceled returns to completed bills.

The branch also retains B, Collapsed archive, and C, History tabs, as the comparison source. These alternatives were not selected. The final implementation should rewrite A without the prototype switcher, fixtures or dev entry.

## Run

From the repository root:

```sh
pnpm --dir client prototype:history
```

Open `http://dev-2a1m:5174/?variant=A#/group-bills/history-prototype` in the T3 preview. The dev server binds to all interfaces. This is the existing group page with sample records matching the screenshot, without sign-in or server requests. Surrounding actions are inactive.

Use the bottom arrows or left/right keys to compare A, B and C. Variant changes update the URL and reset canceled visibility. The sample-case selector covers mixed, all-canceled, no-canceled, long and empty histories. The bottom bar shows the full filtering and row-count state.

The same `?variant=A|B|C` switch is available on an authenticated group page in a normal development server, using its loaded data. Production hides the prototype controls.

## Verification

Frontend lint and build passed. Browser checks verified all three reveal controls, variant switching, A's Show all 7 and Hide canceled behavior, and the sample cases. A and C were checked at 390px with no horizontal overflow. No automated prototype tests were added.

import { useState } from "react";
import { BillApiError, useBillApi, type Bill, type ItemConflicts } from "./bill-api";
import { correctionInput, useReceiptApi, type BillItem, type LegacyCorrectionItem, type ReceiptCorrectionItem, type ReviewedItem } from "./receipt-api";
import { previewCorrection } from "./receipt-correction";
import { ClaimItems } from "./ClaimItems";
import { claimAvailabilityMessage, fromParts, shortText } from "./claim-fractions";
import { acknowledge, claimReview, knownOf, reviewedFor, seenOf, type SeenItem } from "./claim-review";
import { ReceiptReviewItems } from "./ReceiptReview";
import { LegacyItemEditor } from "./LegacyItemEditor";
import { Button } from "./ui";
import { errorMessage } from "./group-api";

function reviewedItems(items: { id: string; version: number }[] = []): ReviewedItem[] {
  return items.map(({ id, version }) => ({ itemId: id, version }));
}

// Names the first item that ran out, with what is left of it for this participant.
function conflictMessage(conflicts: ItemConflicts, items: BillItem[]) {
  const first = conflicts.overAllocated[0];
  if (first) {
    const name = items.find((item) => item.id === first.itemId)?.name ?? "an item";
    const left = fromParts(first.available.numerator, first.available.denominator);
    return `Not saved. Someone just updated ${name} — ${left.n > 0n ? `only ${shortText(left)} left` : "nothing is left"}. Your picks are kept.`;
  }
  if (conflicts.stale.length) return "Not saved. Some items changed since you looked. Your picks are kept; review the marked items to confirm.";
  return null;
}

export function ItemClaims({
  bill,
  saved,
  refresh,
}: {
  bill: Bill;
  saved: (bill: Bill) => void;
  refresh: () => void;
}) {
  const api = useReceiptApi();
  const billApi = useBillApi();
  const own = bill.participants.find((p) => p.isCurrentUser);
  const [selection, setSelection] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      (bill.items ?? []).flatMap((i) =>
        i.claims
          .filter((c) => c.userId === own?.userId)
          .map((c) => [i.id, `${c.numerator}/${c.denominator}`]),
      ),
    ),
  );
  // Acknowledged per item. Only the participant's own look at an item, a pick, or a save
  // that the server checked against every version may advance an entry.
  const [seen, setSeen] = useState<SeenItem[]>(() => (bill.items ?? []).map(seenOf));
  // Items as this page last showed them, so a removed pick can still say what was dropped.
  const [knownFrom, setKnownFrom] = useState(bill.items);
  const [known, setKnown] = useState(() => knownOf(bill.items ?? []));
  if (bill.items !== knownFrom) {
    setKnownFrom(bill.items);
    setKnown((current) => ({ ...current, ...knownOf(bill.items ?? []) }));
  }
  // Items the server said ran out when Confirm was rejected; cleared as each pick changes.
  const [conflicts, setConflicts] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [edit, setEdit] = useState<ReceiptCorrectionItem[] | null>(null);
  const [legacyEdit, setLegacyEdit] = useState<LegacyCorrectionItem[] | null>(null);
  // The items as the editor opened them: edits and their versions are judged
  // against this, not against live updates that arrive while editing.
  const [editBase, setEditBase] = useState<BillItem[]>([]);
  const terminal = !!(bill.completedAt || bill.canceledAt);
  const review = claimReview({ items: bill.items ?? [], ownId: own?.userId, selection, seen, known, conflicts });
  async function perform(action: () => Promise<{ bill: Bill }>, markAllReviewed: boolean) {
    setBusy(true);
    setError("");
    try {
      const result = await action();
      // A whole-list save was checked against every reviewed version. A claim
      // only checks the selected items and never changes versions, so the
      // response may carry changes this user has not reviewed.
      // A pick on an item removed meanwhile stays in the draft, so its row can say it was dropped;
      // a whole-list save removed those items itself.
      if (markAllReviewed) {
        setSeen((result.bill.items ?? []).map(seenOf));
        setSelection(current => Object.fromEntries(Object.entries(current)
          .filter(([id]) => result.bill.items?.some(item => item.id === id))));
      }
      setConflicts([]);
      saved(result.bill);
      setEdit(null);
      setLegacyEdit(null);
    } catch (e) {
      setError(errorMessage(e));
      if (e instanceof BillApiError && e.status === 409) {
        // Someone saved first. The draft is kept; the rows the server named turn red once the
        // refreshed bill arrives, and changed or added items ask for review again.
        const message = e.conflicts && conflictMessage(e.conflicts, bill.items ?? []);
        if (e.conflicts) setConflicts(e.conflicts.overAllocated.map((entry) => entry.itemId));
        if (message) setError(message);
        else try {
          const current = await billApi.detail(bill.id);
          setError(claimAvailabilityMessage(current.bill, selection) ?? errorMessage(e));
        } catch { /* Keep the original server message if the refresh fails. */ }
        refresh();
      }
    } finally {
      setBusy(false);
    }
  }
  function saveLegacyCorrection() {
    if (!legacyEdit || busy) return;
    if (!legacyEdit.length || legacyEdit.some(item => !item.name.trim() || item.amountCents === null ||
      item.finalCents === null || item.finalCents < 0 || item.finalCents > 1_000_000)) {
      setError("Keep at least one item and check each name, printed price and final cost (CAD 0–10,000).");
      return;
    }
    const items = legacyEdit.map(item => ({ ...item, amountCents: item.amountCents!, finalCents: item.finalCents! }));
    void perform(() => api.legacyItems(bill.id, reviewedItems(editBase), items), true);
  }
  async function saveCorrection() {
    if (!edit || busy) return;
    if (edit.some((item) => !item.name.trim() || item.amountCents === null ||
      item.discountCents > item.amountCents || item.finalCents === null)) {
      setError("Check each item's name, printed price, discount and final cost.");
      return;
    }
    setBusy(true);
    setError("");
    let changed = false;
    try {
      for (const item of edit) {
        const original = editBase.find((candidate) => candidate.id === item.id);
        if (!original) throw new Error("An item changed. Reload the bill before correcting it.");
        const input = correctionInput(item);
        const previous = correctionInput(original);
        if (JSON.stringify(input) === JSON.stringify(previous)) continue;
        const result = await api.correctItem(bill.id, item.id, original.version, input);
        changed = true;
        // Only the corrected item is newly seen. Other items in the response
        // may carry changes this user has not reviewed.
        const corrected = result.bill.items?.find(candidate => candidate.id === item.id);
        if (corrected)
          setSeen(current => current.map(entry => entry.itemId === item.id ? seenOf(corrected) : entry));
        saved(result.bill);
      }
      setEdit(null);
    } catch (e) {
      setError(errorMessage(e));
      if (changed || (e instanceof BillApiError && e.status === 409)) {
        setEdit(null);
        refresh();
      }
    } finally {
      setBusy(false);
    }
  }
  function confirm() {
    try {
      const claims = Object.entries(selection)
        .filter(([, text]) => text.trim())
        .map(([itemId, text]) => {
          const match = /^(\d+)(?:\/(\d+))?$/.exec(text.trim());
          if (!match)
            throw new Error(
              "Enter a whole item as 1, or a fraction such as 1/3.",
            );
          const numerator = Number(match[1]),
            denominator = Number(match[2] ?? 1);
          if (numerator < 1 || denominator < numerator || numerator > 10000 || denominator > 10000)
            throw new Error(
              "Use a positive fraction no greater than 1, with numerator and denominator at most 10,000.",
            );
          return { itemId, numerator, denominator };
        });
      void perform(() => api.claims(bill.id, reviewedFor(seen, bill.items ?? []), claims), false);
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  return (
    <section className="item-claims">
      <h2>Items & claims</h2>
      <ClaimItems bill={bill} selection={selection} review={review} change={(id, value) => {
        setSelection((current) => ({ ...current, [id]: value }));
        // Changing a pick the server rejected answers that rejection.
        if (conflicts.includes(id)) {
          setConflicts((current) => current.filter((entry) => entry !== id));
          setError("");
        }
      }} dismissRemoved={(id) => setSelection((current) => Object.fromEntries(Object.entries(current).filter(([key]) => key !== id)))}
        acknowledge={(item) => setSeen((current) => acknowledge(current, item))}
        busy={busy} terminal={terminal} error={error}
        confirmAction={!terminal && own ? <Button disabled={busy || review.blockers.length > 0} onClick={confirm}>
          {busy ? "Saving…" : Object.values(selection).some((value) => value.trim())
            ? "Confirm my item claims" : "Confirm I purchased nothing"}
        </Button> : null} />
      {!terminal && own && (
        <p>
          Confirm submits all your selections and calculates your share. Empty
          selections confirm that you purchased nothing and release your
          existing claims or reservations. Fractions use integers from 1 to
          10,000.
        </p>
      )}
      {!terminal && own?.userId === bill.initiatorId && (
        <>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => {
              setError("");
              if (bill.receipt) {
                setLegacyEdit(null);
                setEdit((bill.items ?? []).map(item => ({ ...item, manualFinal: !!item.manualFinal })));
              } else {
                const items: LegacyCorrectionItem[] = [];
                for (const item of bill.items ?? []) {
                  if (item.taxCents === null || item.extraCents === null) {
                    setError("This older bill is missing item tax or adjustment amounts. Reload before editing.");
                    return;
                  }
                  items.push({ id: item.id, name: item.name, originalText: item.originalText,
                    quantity: item.quantity, amountCents: item.amountCents, discountCents: item.discountCents,
                    taxCents: item.taxCents, extraCents: item.extraCents, finalCents: item.finalCents,
                    manualFinal: item.manualFinal });
                }
                setEdit(null);
                setLegacyEdit(items);
              }
              setEditBase(bill.items ?? []);
            }}
          >
            Edit items & prices
          </Button>
          {(edit || legacyEdit) && (
            <div className="receipt-correction">
              {legacyEdit && <LegacyItemEditor items={legacyEdit} change={setLegacyEdit} />}
              {edit && <ReceiptReviewItems mode="correction" hasFrozenRate={!!bill.frozenTaxRate} items={edit} change={(items) => setEdit(items.map((item) => {
                const original = editBase.find((candidate) => candidate.id === item.id);
                return original ? previewCorrection(bill, original, item) : item;
              }))} />}
              <p>Price changes reserve only the corrected item's claims until their owners reconfirm. Other items stay confirmed.</p>
              <div className="receipt-correction-actions">
                {/* Claim review does not gate corrections: the server checks them against editBase. */}
                <Button disabled={busy} onClick={() => legacyEdit ? saveLegacyCorrection() : void saveCorrection()}>
                  {busy ? "Saving…" : "Save item changes"}
                </Button>
                <Button variant="text" disabled={busy} onClick={() => { setEdit(null); setLegacyEdit(null); }}>
                  Keep current items
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}

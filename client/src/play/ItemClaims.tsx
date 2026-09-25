import { useState } from "react";
import { BillApiError, useBillApi, type Bill } from "./bill-api";
import { correctionInput, useReceiptApi, type ReceiptCorrectionItem } from "./receipt-api";
import { previewCorrection } from "./receipt-correction";
import { ClaimItems } from "./ClaimItems";
import { claimAvailabilityMessage } from "./claim-fractions";
import { ReceiptReviewItems } from "./ReceiptReview";
import { Button } from "./ui";
import { errorMessage } from "./group-api";

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
  const [reviewed, setReviewed] = useState(bill.revision);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [edit, setEdit] = useState<ReceiptCorrectionItem[] | null>(null);
  const terminal = !!(bill.completedAt || bill.canceledAt);
  const stale = reviewed !== bill.revision;
  async function perform(action: () => Promise<{ bill: Bill }>) {
    setBusy(true);
    setError("");
    try {
      const result = await action();
      setReviewed(result.bill.revision);
      saved(result.bill);
      setEdit(null);
    } catch (e) {
      setError(errorMessage(e));
      if (e instanceof BillApiError && e.status === 409) {
        // A simultaneous claimant can take the last fraction before our stale
        // revision reaches the server. Show the actual current availability.
        try {
          const current = await billApi.detail(bill.id);
          setError(claimAvailabilityMessage(current.bill, selection) ?? errorMessage(e));
        } catch { /* Keep the original server message if the refresh fails. */ }
        refresh();
      }
    } finally {
      setBusy(false);
    }
  }
  async function saveCorrection() {
    if (!edit || busy || stale) return;
    if (edit.some((item) => !item.name.trim() || item.amountCents === null ||
      item.discountCents > item.amountCents || item.finalCents === null)) {
      setError("Check each item's name, printed price, discount and final cost.");
      return;
    }
    setBusy(true);
    setError("");
    let revision = reviewed;
    let changed = false;
    try {
      if (!bill.receipt) {
        // Existing bills have no frozen rate. Preserve their stored tax and other
        // adjustments, changing a final cost only when explicitly set manually.
        const items = edit.map((item) => {
          const original = bill.items!.find((candidate) => candidate.id === item.id)!;
          return {
            id: item.id, name: item.name, originalText: original.originalText,
            quantity: item.quantity, amountCents: item.amountCents!,
            discountCents: item.discountCents, taxCents: original.taxCents,
            extraCents: original.extraCents,
            finalCents: item.manualFinal ? item.finalCents! : original.finalCents,
          };
        });
        const result = await api.legacyItems(bill.id, revision, items);
        setReviewed(result.bill.revision);
        saved(result.bill);
        setEdit(null);
        return;
      }
      for (const item of edit) {
        const original = bill.items?.find((candidate) => candidate.id === item.id);
        if (!original) throw new Error("An item changed. Reload the bill before correcting it.");
        const input = correctionInput(item);
        const previous = correctionInput(original);
        if (JSON.stringify(input) === JSON.stringify(previous)) continue;
        const result = await api.correctItem(bill.id, item.id, revision, input);
        revision = result.bill.revision;
        changed = true;
        saved(result.bill);
      }
      setReviewed(revision);
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
      void perform(() => api.claims(bill.id, reviewed, claims));
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  return (
    <section className="item-claims">
      <h2>Items & claims</h2>
      <ClaimItems bill={bill} selection={selection} change={(id, value) =>
        setSelection((current) => ({ ...current, [id]: value }))} busy={busy} terminal={terminal} error={error}
        confirmAction={!terminal && own ? <Button disabled={busy || stale} onClick={confirm}>
          {busy ? "Saving…" : Object.values(selection).some((value) => value.trim())
            ? "Confirm my item claims" : "Confirm I purchased nothing"}
        </Button> : null} />
      {!terminal && own && (
        <>
          <p>
            Confirm submits all your selections and calculates your share. Empty
            selections confirm that you purchased nothing and release your
            existing claims or reservations. Fractions use integers from 1 to
            10,000.
          </p>
          {stale && (
            <div role="alert">
              <p>
                The bill changed. Your selections are kept. Review current
                prices and availability before confirming.
              </p>
              <Button
                variant="secondary"
                onClick={() => {
                  setReviewed(bill.revision);
                  setSelection((s) =>
                    Object.fromEntries(
                      Object.entries(s).filter(([id]) =>
                        bill.items?.some((i) => i.id === id),
                      ),
                    ),
                  );
                }}
              >
                I have reviewed the latest bill
              </Button>
            </div>
          )}
        </>
      )}
      {!terminal && own?.userId === bill.initiatorId && (
        <>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => {
              setEdit((bill.items ?? []).map((item) => ({ ...item })));
              setReviewed(bill.revision);
            }}
          >
            Edit items & prices
          </Button>
          {edit && (
            <div className="receipt-correction">
              {!bill.receipt && <p>This older bill has no stored receipt summary, so tax and adjustment derivations are unavailable. Its existing costs will stay unchanged unless you set a final cost manually.</p>}
              <ReceiptReviewItems mode="correction" hasFrozenRate={!!bill.frozenTaxRate} items={edit} change={(items) => setEdit(items.map((item) => {
                const original = bill.items?.find((candidate) => candidate.id === item.id);
                return original ? previewCorrection(bill, original, item) : item;
              }))} />
              <p>Price changes reserve only the corrected item's claims until their owners reconfirm. Other items stay confirmed.</p>
              <div className="receipt-correction-actions">
                <Button disabled={busy || stale} onClick={() => void saveCorrection()}>
                  {busy ? "Saving…" : "Save item changes"}
                </Button>
                <Button variant="text" disabled={busy} onClick={() => setEdit(null)}>
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

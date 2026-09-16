import { useState } from "react";
import { BillApiError, money, type Bill } from "./bill-api";
import { cleanItem, useReceiptApi, type ReceiptDraftItem } from "./receipt-api";
import { ReceiptPhoto } from "./ReceiptPhoto";
import { ReceiptItemEditor } from "./ReceiptItemEditor";
import { Button } from "./ui";
import { errorMessage } from "./group-api";

function available(claims: { numerator: number; denominator: number }[]) {
  let n = 1n,
    d = 1n;
  for (const c of claims) {
    n = n * BigInt(c.denominator) - BigInt(c.numerator) * d;
    d *= BigInt(c.denominator);
  }
  function gcd(a: bigint, b: bigint): bigint {
    return b ? gcd(b, a % b) : a;
  }
  const g = gcd(n, d);
  return `${n / g}/${d / g}`;
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
  const [edit, setEdit] = useState<ReceiptDraftItem[] | null>(null);
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
      if (e instanceof BillApiError && e.status === 409) refresh();
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
          if (numerator < 1 || denominator < numerator || denominator > 10000)
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
      <div className="receipt-review-layout">
        <div>
          {bill.photo ? (
            <ReceiptPhoto
              id={bill.photo.draftId}
              expired={bill.photo.expired}
            />
          ) : (
            <p>
              No receipt photo is available. Photos expire after six months.
            </p>
          )}
        </div>
        <div>
          {(bill.items ?? []).map((item) => (
            <article className="receipt-edit-row" key={item.id}>
              <h3>
                {item.name} <span>{money(item.finalCents)}</span>
              </h3>
              <p>
                Quantity {item.quantity} · Printed amount{" "}
                {money(item.amountCents)}
              </p>
              <details>
                <summary>Original receipt text</summary>
                <p>{item.originalText || "Manually entered item"}</p>
              </details>
              <p>
                Available to you:{" "}
                {available(item.claims.filter((c) => c.userId !== own?.userId))}
              </p>
              {item.claims.map((c) => (
                <p key={c.userId}>
                  {
                    bill.participants.find((p) => p.userId === c.userId)
                      ?.displayName
                  }
                  : {c.numerator}/{c.denominator} ·{" "}
                  {c.confirmedAt
                    ? "Confirmed"
                    : "Reserved, needs reconfirmation"}
                </p>
              ))}
              {own && !terminal && (
                <div className="receipt-costs">
                  <label>
                    Your selection, not yet submitted
                    <input
                      aria-label={`Your fraction of ${item.name}`}
                      value={selection[item.id] ?? ""}
                      disabled={busy}
                      placeholder="1 or 1/3"
                      onChange={(e) =>
                        setSelection((s) => ({
                          ...s,
                          [item.id]: e.target.value,
                        }))
                      }
                    />
                  </label>
                  <Button
                    variant="text"
                    disabled={busy}
                    onClick={() =>
                      setSelection((s) => ({ ...s, [item.id]: "1" }))
                    }
                  >
                    Whole item
                  </Button>
                  <Button
                    variant="text"
                    disabled={busy}
                    onClick={() =>
                      setSelection((s) => ({ ...s, [item.id]: "" }))
                    }
                  >
                    Remove my selection
                  </Button>
                </div>
              )}
            </article>
          ))}
        </div>
      </div>
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
          <Button disabled={busy || stale} onClick={confirm}>
            {busy
              ? "Saving…"
              : Object.values(selection).some((s) => s.trim())
                ? "Confirm my item claims"
                : "Confirm I purchased nothing"}
          </Button>
        </>
      )}
      {!terminal && own?.userId === bill.initiatorId && (
        <>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => {
              setEdit((bill.items ?? []).map(cleanItem));
              setReviewed(bill.revision);
            }}
          >
            Edit items & prices
          </Button>
          {edit && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (
                  !edit.every(
                    (i) => i.finalCents !== null && i.amountCents !== null,
                  )
                ) {
                  setError("Fill in item costs.");
                  return;
                }
                const items = edit.map((i) =>
                  cleanItem({
                    ...i,
                    amountCents: i.amountCents!,
                    finalCents: i.finalCents!,
                  }),
                );
                void perform(() => api.items(bill.id, reviewed, items));
              }}
            >
              <ReceiptItemEditor items={edit} change={setEdit} />
              <p>
                Price changes reserve affected claims until their owners
                reconfirm. Other items stay confirmed.
              </p>
              <Button type="submit" disabled={busy || stale}>
                Save item changes
              </Button>
              <Button variant="text" onClick={() => setEdit(null)}>
                Keep current items
              </Button>
            </form>
          )}
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}

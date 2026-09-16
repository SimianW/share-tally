import { useEffect, useRef, useState } from "react";
import {
  BillApiError,
  parseMoney,
  type Bill,
  type BillApi,
  type BillEdit,
} from "./bill-api";
import { errorMessage, useGroupApi, type GroupDetail } from "./group-api";
import { Button } from "./ui";
import Dialog from "./Dialog";

type Props = {
  bill: Bill;
  api: BillApi;
  saved: (bill: Bill) => void;
  refresh: () => void;
};

// Keep an uncertain request unchanged. Version checks make retries safe even if
// the first response was lost; a 409 requires reviewing the latest bill.
function useMutation(saved: Props["saved"]) {
  const pending = useRef(false);
  const attempt = useRef<(() => Promise<{ bill: Bill }>) | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [retry, setRetry] = useState(false);
  async function run(action: () => Promise<{ bill: Bill }>) {
    if (pending.current || conflict) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      attempt.current ??= action;
      const result = await attempt.current();
      attempt.current = null;
      setRetry(false);
      saved(result.bill);
    } catch (error) {
      const definite = error instanceof BillApiError && error.status < 500;
      if (definite) attempt.current = null;
      setRetry(!definite);
      setConflict(
        error instanceof BillApiError && [403, 404, 409].includes(error.status),
      );
      setError(errorMessage(error));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return {
    run,
    busy,
    error,
    conflict,
    retry,
    locked: busy || retry || conflict,
  };
}
function MutationError({
  mutation,
  refresh,
}: {
  mutation: ReturnType<typeof useMutation>;
  refresh: () => void;
}) {
  if (!mutation.error) return null;
  return (
    <div role="alert" className="form-error">
      <p>{mutation.error}</p>
      {mutation.conflict ? (
        <Button variant="secondary" onClick={refresh}>
          Review latest bill
        </Button>
      ) : mutation.retry ? (
        <p>The response was not received. Retry sends the same request.</p>
      ) : null}
    </div>
  );
}

export function ShareActions({ bill, api, saved, refresh }: Props) {
  const own = bill.participants.find((p) => p.isCurrentUser)!;
  const [amount, setAmount] = useState(
    own.amountCents === null ? "" : (own.amountCents / 100).toFixed(2),
  );
  const [validation, setValidation] = useState("");
  const mutation = useMutation(saved);
  let parsedAmount: number | null = null;
  try {
    parsedAmount = parseMoney(amount);
  } catch {
    /* Show validation on submit. */
  }
  const changed = own.amountCents !== null && parsedAmount !== own.amountCents;
  return (
    <form
      className="share-form"
      onSubmit={(e) => {
        e.preventDefault();
        setValidation("");
        let amountCents: number;
        try {
          amountCents = parseMoney(amount);
          if (amountCents > bill.totalCents)
            throw new Error("Your share cannot exceed the bill total.");
        } catch (error) {
          setValidation(errorMessage(error));
          return;
        }
        void mutation.run(() =>
          api.submit(bill.id, {
            amountCents,
            expectedAmountCents: own.amountCents,
            revision: bill.revision,
          }),
        );
      }}
    >
      <span className="eyebrow">YOUR SHARE</span>
      <h2>
        {own.confirmedAt
          ? "Your share is confirmed."
          : own.amountCents === null
            ? "Confirm your share"
            : "Check your saved amount."}
      </h2>
      <label>
        My share · CAD
        <input
          required
          inputMode="decimal"
          value={amount}
          disabled={mutation.locked}
          onChange={(e) => setAmount(e.target.value)}
        />
      </label>
      <p>
        {changed
          ? "Changing your amount clears everyone’s confirmation, including yours. Review and confirm again after saving."
          : own.amountCents === null
            ? "Include your tax, discounts, and rounding. Enter 0 if you have no cost."
            : "Confirming the same amount keeps everyone else’s confirmation."}
      </p>
      {validation && (
        <p role="alert" className="form-error">
          {validation}
        </p>
      )}
      <MutationError mutation={mutation} refresh={refresh} />
      <Button
        type="submit"
        disabled={
          mutation.busy || mutation.conflict || (!!own.confirmedAt && !changed)
        }
      >
        {mutation.busy
          ? "Saving..."
          : mutation.retry
            ? "Retry confirmation"
            : changed
              ? "Save changed amount"
              : own.amountCents === null
                ? "Submit and confirm my share"
                : "Confirm my share"}
      </Button>
    </form>
  );
}

export function InitiatorActions({ bill, api, saved, refresh }: Props) {
  const [panel, setPanel] = useState<"edit" | "reopen" | "cancel" | null>(null);
  function updated(next: Bill) {
    setPanel(null);
    saved(next);
  }
  function review() {
    setPanel(null);
    refresh();
  }
  if (bill.canceledAt) return null;
  return (
    <section className="bill-controls">
      <span className="eyebrow">INITIATOR CONTROLS</span>
      {bill.completedAt && (
        <Button onClick={() => setPanel("reopen")}>Reopen bill</Button>
      )}
      <Button variant="secondary" onClick={() => setPanel("edit")}>
        Edit details & participants
      </Button>
      {!bill.completedAt && (
        <button className="bill-danger" onClick={() => setPanel("cancel")}>
          Cancel this bill
        </button>
      )}
      {panel === "edit" && (
        <EditBill
          bill={bill}
          api={api}
          saved={updated}
          refresh={review}
          close={() => setPanel(null)}
        />
      )}
      {(panel === "reopen" || panel === "cancel") && (
        <ChangeBill
          bill={bill}
          api={api}
          saved={updated}
          refresh={review}
          action={panel}
          close={() => setPanel(null)}
        />
      )}
    </section>
  );
}
function ChangeBill({
  bill,
  api,
  saved,
  refresh,
  action,
  close,
}: Props & { action: "reopen" | "cancel"; close: () => void }) {
  const mutation = useMutation(saved);
  return (
    <Dialog
      title={action === "reopen" ? "Reopen this bill?" : "Cancel this bill?"}
      kicker={bill.title}
      close={() => {
        if (!mutation.busy) close();
      }}
    >
      <p>
        {action === "reopen"
          ? "Everyone’s amounts stay. All confirmations will be cleared. The bill leaves financial totals until everyone confirms and it completes again."
          : "This bill will stay visible as canceled and be excluded from financial totals. Participants can no longer submit or confirm shares."}
      </p>
      <MutationError mutation={mutation} refresh={refresh} />
      <div className="dialog-actions">
        <Button
          onClick={() =>
            void mutation.run(() => api.change(bill.id, action, bill.revision))
          }
          disabled={mutation.busy || mutation.conflict}
        >
          {mutation.busy
            ? "Saving..."
            : mutation.retry
              ? "Retry request"
              : action === "reopen"
                ? "Reopen & clear confirmations"
                : "Yes, cancel bill"}
        </Button>
        <Button variant="secondary" onClick={close} disabled={mutation.busy}>
          Keep current bill
        </Button>
      </div>
    </Dialog>
  );
}
function EditBill({
  bill,
  api,
  saved,
  refresh,
  close,
}: Props & { close: () => void }) {
  const groups = useGroupApi();
  const [group, setGroup] = useState<GroupDetail | null>(null);
  const [loadError, setLoadError] = useState("");
  const [loadVersion, setLoadVersion] = useState(0);
  const [title, setTitle] = useState(bill.title);
  const [date, setDate] = useState(bill.purchaseDate);
  const [notes, setNotes] = useState(bill.notes);
  const [total, setTotal] = useState((bill.totalCents / 100).toFixed(2));
  const [selected, setSelected] = useState(
    bill.participants.map((p) => p.userId),
  );
  const [validation, setValidation] = useState("");
  const mutation = useMutation(saved);
  useEffect(() => {
    const controller = new AbortController();
    groups
      .detail(bill.groupId, controller.signal)
      .then(({ group }) => {
        if (!controller.signal.aborted) {
          setGroup(group);
          setLoadError("");
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) setLoadError(errorMessage(error));
      });
    return () => controller.abort();
  }, [groups, bill.groupId, loadVersion]);
  return (
    <Dialog
      title="Edit bill"
      kicker={bill.title}
      close={() => {
        if (!mutation.busy) close();
      }}
    >
      <form
        className="bill-form"
        onSubmit={(e) => {
          e.preventDefault();
          setValidation("");
          let totalCents: number;
          try {
            totalCents = parseMoney(total);
            if (!totalCents) throw new Error("Bill total must be positive.");
          } catch (error) {
            setValidation(errorMessage(error));
            return;
          }
          const input: BillEdit = {
            title,
            purchaseDate: date,
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            notes,
            totalCents,
            participantIds: selected,
            revision: bill.revision,
          };
          void mutation.run(() => api.edit(bill.id, input));
        }}
      >
        <p className="bill-warning">
          Saving any edit reopens this bill and clears everyone’s confirmation,
          even if you only change its description. Existing amounts stay.
        </p>
        <fieldset disabled={mutation.locked}>
          <label>
            Title
            <input
              required
              maxLength={120}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <div className="bill-money-fields">
            <label>
              Purchase date
              <input
                type="date"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>
            <label>
              Total · CAD
              <input
                required
                inputMode="decimal"
                value={total}
                onChange={(e) => setTotal(e.target.value)}
              />
            </label>
          </div>
          <label>
            Notes
            <textarea
              maxLength={2000}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </label>
          <fieldset>
            <legend>Who shared this purchase?</legend>
            {group?.members.map((p) => (
              <label className="participant-choice" key={p.id}>
                <input
                  type="checkbox"
                  checked={selected.includes(p.id)}
                  disabled={p.id === bill.initiatorId}
                  onChange={(e) =>
                    setSelected((current) =>
                      e.target.checked
                        ? [...current, p.id]
                        : current.filter((id) => id !== p.id),
                    )
                  }
                />
                {p.displayName}
                {p.id === bill.initiatorId
                  ? " · Initiator, always included"
                  : ""}
              </label>
            ))}
          </fieldset>
          <p>
            Removing someone affects only this bill. They stay in the group. You
            can only edit your own share.
          </p>
        </fieldset>
        {loadError ? (
          <div role="alert">
            <p>{loadError}</p>
            <Button
              variant="secondary"
              onClick={() => setLoadVersion((n) => n + 1)}
            >
              Retry participants
            </Button>
          </div>
        ) : !group ? (
          <p role="status">Loading participants...</p>
        ) : null}
        {validation && (
          <p role="alert" className="form-error">
            {validation}
          </p>
        )}
        <MutationError mutation={mutation} refresh={refresh} />
        <div className="dialog-actions">
          <Button
            type="submit"
            disabled={!group || mutation.busy || mutation.conflict}
          >
            {mutation.busy
              ? "Saving..."
              : mutation.retry
                ? "Retry request"
                : "Save & request confirmations"}
          </Button>
          <Button variant="secondary" onClick={close} disabled={mutation.busy}>
            Keep current bill
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

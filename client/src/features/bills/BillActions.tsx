import { amountText } from '../../shared/money';
import { type Bill, type BillEdit } from "@share-tally/domain/contracts/bills";
import { useEffect, useState } from "react";
import { errorMessage } from "../../shared/api/error-message";
import { parseMoney } from "../../shared/money";
import { Button } from "../../shared/ui/Button";
import Dialog from "../../shared/ui/Dialog";
import { Notification } from '../../shared/ui/Notification';
import { useNotePhotoApi } from '../../shared/api/note-photos';
import { NotePhotoEditor } from '../../shared/ui/note-photos/NotePhotos';
import { useNotePhotos } from '../../shared/ui/note-photos/use-note-photos';
import { ParticipantPicker } from "../../shared/ui/ParticipantPicker";
import { AmountPortion } from "../../shared/ui/portions/AmountPortion";
import type { Fraction } from '@share-tally/domain/fractions';
import { useGroupApi, type GroupDetail } from "../groups/api";
import { type BillApi } from "./api";
import { useBillDraftReview, useBillMutation } from './use-bill-mutation';

type Props = {
  bill: Bill;
  api: BillApi;
  saved: (bill: Bill) => void;
  refresh: () => void;
};
function MutationError({
  mutation,
  refresh,
}: {
  mutation: ReturnType<typeof useBillMutation>;
  refresh: () => void;
}) {
  if (!mutation.error) return null;
  return (
    <Notification>
      <p>{mutation.error}</p>
      {mutation.conflict ? (
        <Button variant="secondary" onClick={refresh}>
          Review latest bill
        </Button>
      ) : mutation.retry ? (
        <p>The response was not received. Retry sends the same request.</p>
      ) : null}
    </Notification>
  );
}
function DraftNotice({ bill, review }: { bill: Bill; review: ReturnType<typeof useBillDraftReview> }) {
  if (!review.notice) return null;
  return <Notification tone="warning" title="Review the latest bill">
    <p>{review.notice}</p>
    {!review.terminal && <>
      <p>Latest: {bill.title} · {bill.purchaseDate} · CAD {amountText(bill.totalCents)} · {bill.participants.map(p => p.displayName).join(', ')}</p>
      {bill.notes && <p>{bill.notes}</p>}
      <Button variant="secondary" onClick={review.review}>Review latest bill</Button>
    </>}
  </Notification>;
}

export function ShareActions(props: Props) {
  const eligible = !props.bill.completedAt && !props.bill.canceledAt && props.bill.participants.some(p => p.isCurrentUser);
  const [opened, setOpened] = useState(eligible);
  if (!opened && eligible) setOpened(true);
  if (!opened && !eligible) return null;
  return <ShareEditor {...props} />;
}
function ShareEditor({ bill, api, saved, refresh }: Props) {
  const currentOwn = bill.participants.find(p => p.isCurrentUser);
  const [initialOwn] = useState(currentOwn!);
  const own = currentOwn ?? initialOwn;
  const [amount, setAmount] = useState(
    own.amountCents === null ? "" : amountText(own.amountCents),
  );
  const [validation, setValidation] = useState("");
  // The Custom fraction last used on this share form.
  const [custom, setCustom] = useState<Fraction | null>(null);
  const mutation = useBillMutation(saved);
  const review = useBillDraftReview(bill, `${bill.revision}:${currentOwn?.amountCents}:${!!currentOwn}`, mutation);
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
        if (review.blocked || !currentOwn) return;
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
      <DraftNotice bill={bill} review={review} />
      {!currentOwn && <Notification tone="warning" title="Participation changed">You are no longer a participant. Your draft is retained; submission is disabled.</Notification>}
      <span className="eyebrow">YOUR SHARE</span>
      <h2>
        {own.confirmedAt
          ? "Your share is confirmed."
          : own.amountCents === null
            ? "Confirm your share"
            : "Check your saved amount."}
      </h2>
      <AmountPortion
        totalCents={bill.totalCents}
        count={bill.participants.length}
        others={bill.participants.filter((p) => !p.isCurrentUser).map((person) => ({ person, cents: person.amountCents }))}
        amount={amount}
        setAmount={setAmount}
        custom={custom}
        setCustom={setCustom}
        inputId="my-share-amount"
        required
        busy={mutation.busy}
        readOnly={mutation.locked || review.terminal || !currentOwn}
      />
      <p>
        {review.terminal
          ? "This bill is final. Your share can no longer be changed."
          : changed
          ? "Saving confirms your new amount. Everyone else’s confirmation stays."
          : own.amountCents === null
            ? "Include your tax, discounts, and rounding. Enter 0 if you have no cost."
            : own.confirmedAt
              ? "You can still edit your amount above. Saving a change confirms it and keeps everyone else’s confirmation."
              : "Confirming the same amount keeps everyone else’s confirmation."}
      </p>
      {validation && (
        <Notification>
          {validation}
        </Notification>
      )}
      <MutationError mutation={mutation} refresh={() => { review.review(); refresh(); }} />
      <Button
        type="submit"
        disabled={
          review.blocked || !currentOwn || mutation.busy || mutation.conflict || (!!own.confirmedAt && !changed)
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
  const [panel, setPanel] = useState<"edit" | "cancel" | null>(null);
  function updated(next: Bill) {
    setPanel(null);
    saved(next);
  }
  function review() { refresh(); }
  const terminal = !!(bill.canceledAt || bill.completedAt);
  if (terminal && !panel) return null;
  return (
    <section className="bill-controls">
      <span className="eyebrow">INITIATOR CONTROLS</span>
      <Button variant="secondary" disabled={terminal} onClick={() => setPanel("edit")}>
        Edit details & participants
      </Button>
      {!terminal && (
        <Button variant="secondary" className="bill-danger" onClick={() => setPanel("cancel")}>
          Cancel this bill
        </Button>
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
      {panel === "cancel" && (
        <CancelBill
          bill={bill}
          api={api}
          saved={updated}
          refresh={review}
          close={() => setPanel(null)}
        />
      )}
    </section>
  );
}
function CancelBill({
  bill,
  api,
  saved,
  refresh,
  close,
}: Props & { close: () => void }) {
  const mutation = useBillMutation(saved);
  const review = useBillDraftReview(bill, String(bill.revision), mutation);
  return (
    <Dialog
      title="Cancel this bill?"
      kicker={bill.title}
      close={() => {
        if (!mutation.busy) close();
      }}
    >
      <p>
        This bill will stay visible as canceled and be excluded from financial
        totals. Participants can no longer submit or confirm shares.
      </p>
      <DraftNotice bill={bill} review={review} />
      <MutationError mutation={mutation} refresh={() => { review.review(); refresh(); }} />
      <div className="dialog-actions">
        <Button
          onClick={() =>
            !review.blocked && void mutation.run(() => api.cancel(bill.id, bill.revision))
          }
          disabled={review.blocked || mutation.busy || mutation.conflict}
        >
          {mutation.busy
            ? "Saving..."
            : mutation.retry
              ? "Retry request"
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
  const [total, setTotal] = useState(amountText(bill.totalCents));
  const [selected, setSelected] = useState(
    bill.participants.map((p) => p.userId),
  );
  const [validation, setValidation] = useState("");
  const mutation = useBillMutation(saved);
  const review = useBillDraftReview(bill, String(bill.revision), mutation);
  const notePhotoApi = useNotePhotoApi();
  // Photos save as they are added or removed, outside this form's revision.
  const notePhotos = useNotePhotos({
    photos: bill.notePhotos,
    upload: (base64) => notePhotoApi.addToBill(bill.id, base64),
    remove: notePhotoApi.remove,
    changed: refresh,
  });
  let totalChanged = true;
  try {
    totalChanged = parseMoney(total) !== bill.totalCents;
  } catch {
    /* Show validation on submit. */
  }
  // Reread members whenever the live bill is reread, so participant names stay current.
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
  }, [groups, bill.groupId, loadVersion, bill]);
  return (
    <Dialog
      title="Edit bill"
      kicker={bill.title}
      close={() => {
        if (!mutation.busy && !notePhotos.busy) close();
      }}
    >
      <form
        className="bill-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (review.blocked) return;
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
        {bill.mode === "items" ? (
          <p>
            Remaining participants keep their confirmations. Removing someone
            deletes their item claims, and anyone you add starts unconfirmed.
            Changing the total only changes your adjustment.
          </p>
        ) : totalChanged ? (
          <Notification tone="warning" title="Everyone will need to confirm again">
            Changing the total clears everyone’s confirmation, including yours.
            Existing amounts stay.
          </Notification>
        ) : (
          <p>Confirmations stay when you change only the title, date, notes or participants.</p>
        )}
        <fieldset disabled={mutation.busy}>
          <label>
            Title
            <input
              readOnly={mutation.locked || review.terminal}
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
                readOnly={mutation.locked || review.terminal}
                type="date"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>
            <label>
              Total · CAD
              <input
                readOnly={mutation.locked || review.terminal}
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
              readOnly={mutation.locked || review.terminal}
              maxLength={2000}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </label>
          <NotePhotoEditor photos={notePhotos} disabled={review.terminal} />
          <p className="note-photo-hint">Photos are saved as soon as you add or remove them, and keep everyone’s confirmations.</p>
          {group && (
            <ParticipantPicker
              members={group.members}
              selected={selected}
              lockedId={bill.initiatorId}
              readOnly={mutation.locked || review.terminal}
              change={setSelected}
            />
          )}
          <p>Removing someone only affects this bill.</p>
        </fieldset>
        {loadError ? (
          <Notification>
            <p>{loadError}</p>
            <Button
              variant="secondary"
              onClick={() => setLoadVersion((n) => n + 1)}
            >
              Retry participants
            </Button>
          </Notification>
        ) : !group ? (
          <p role="status">Loading participants...</p>
        ) : null}
        {validation && (
          <Notification>
            {validation}
          </Notification>
        )}
        <DraftNotice bill={bill} review={review} />
        <MutationError mutation={mutation} refresh={() => { review.review(); refresh(); }} />
        <div className="dialog-actions">
          <Button
            type="submit"
            disabled={!group || review.blocked || mutation.busy || mutation.conflict}
          >
            {mutation.busy
              ? "Saving..."
              : mutation.retry
                ? "Retry request"
                : "Save & request confirmations"}
          </Button>
          <Button variant="secondary" onClick={close} disabled={mutation.busy || notePhotos.busy}>
            Keep current bill
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

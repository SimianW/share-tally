import { type Bill } from "@share-tally/domain/contracts/bills";
import { ArrowLeft, ArrowRight, Check, Trash2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "../../../shared/ui/Button";
import { Notification } from "../../../shared/ui/Notification";
import { type GroupDetail } from "../../groups/api";
import { ReceiptCrop } from "../photos/ReceiptCrop";
import { unassignedReceiptTaxMessage } from "../pricing/receipt-pricing";
import { ReceiptReconciliation, ReceiptSummary } from "../review/ReceiptReview";
import { DeleteDraftDialog } from './DeleteDraftDialog';
import { DiscardChangesDialog } from "./DiscardChangesDialog";
import { type Operation, type Step, canOpenStep, opened, itemsComplete, itemsReady, shareable, stepAvailable } from './draft-model';
import { ReceiptItemsStep } from "./ReceiptItemsStep";
import { ReceiptSharingStep } from './ReceiptSharingStep';
import { useDraftEditor } from "./use-draft-editor";
// PROTOTYPE (throwaway): entry-screen variants switched by ?variant=.
import { PrototypeSwitcher } from "../../../shared/ui/PrototypeSwitcher";
import { usePrototypeVariant } from "../../../shared/ui/prototype-variant";
import { entryVariantKeys, entryVariants } from "./prototype-bill-entry/variants";

const activityLabels: Partial<Record<Operation, string>> = {
  saving: "Saving draft…",
  scanning: "Reading receipt…",
  confirming: "Confirming item…",
  reloading: "Reloading…",
  deleting: "Deleting…",
  initiating: "Sharing…",
};

export function ReceiptDraftForm({
  group,
  id,
  close,
  created,
}: {
  group: GroupDetail;
  id?: string;
  close: () => void;
  created: (bill: Bill) => void;
}) {
  const me = group.members.find((m) => m.isCurrentUser)!;
  const [file, setFile] = useState<File | null>(null);
  const editor = useDraftEditor({ userId: me.id, groupId: group.id, id, photoSelected: !!file, close, created });
  const { state } = editor;
  const draft = state.local;
  const step = state.step;
  const opening = state.operation === "opening";
  const running = state.operation !== "idle";
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  // Split by item, an empty total paid follows the items; this shows its input anyway.
  const [enteringTotal, setEnteringTotal] = useState(false);
  const [replace, setReplace] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const stepHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (opening) return;
    window.scrollTo({ top: 0 });
    stepHeading.current?.focus({ preventScroll: true });
  }, [step, opening]);
  const scan = () => void editor.scan().then((scanned) => { if (scanned) setReplace(false); });
  const data = draft.data;
  const processing = draft.processingStatus === "processing";
  const locked = running || !!draft.initializationRevision || processing;
  const unassignedTaxMessage = unassignedReceiptTaxMessage(data);
  const splitLegendId = useId();
  const stepDone = [step > 0, step > 1 && itemsReady(data), false];
  const unavailable = state.operation === "ended" && !!state.error;
  const variantKey = usePrototypeVariant(entryVariantKeys);
  const entry = entryVariants.find((v) => v.key === variantKey)!;
  const form = (
    <div className="receipt-wizard">
      <header className="receipt-page-heading">
        <Button variant="text" onClick={() => editor.requestClose()}> <ArrowLeft size={18} aria-hidden="true" /> Back to group</Button>
        <div className="eyebrow">SHARETALLY / NEW BILL</div>
        <h1>{id ? "Continue your draft" : "New bill"} <span>· {group.name}</span></h1>
      </header>
      {opening ? (
        <p>Opening draft…</p>
      ) : unavailable ? (
        <Notification tone="error" title="Draft unavailable">
          <p>{state.error}</p>
        </Notification>
      ) : !opened(state) ? (
        <Notification tone="error" title="Could not open this draft">
          <p>{state.error}</p>
          <Button variant="text" onClick={editor.retryOpen}>Try again</Button>
        </Notification>
      ) : (
        <form
          className="bill-form"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (processing || step !== 2 || unassignedTaxMessage || !e.currentTarget.reportValidity()) return;
            if (shareable(state)) void editor.share();
          }}
        >
          <nav aria-label="New bill steps" className="receipt-steps">
            {(["Receipt", "Items", "People"] as const).map(
              (label, index) => (
                <button
                  type="button"
                  key={label}
                  aria-current={step === index ? "step" : undefined}
                  disabled={!stepAvailable(state, index)}
                  onClick={() => editor.chooseStep(index as Step)}
                >
                  <span>
                    {stepDone[index] ? (
                      <Check size={16} aria-hidden="true" />
                    ) : (
                      `0${index + 1}`
                    )}
                  </span>
                  {label}
                </button>
              ),
            )}
          </nav>
          <h3 className="receipt-step-title" ref={stepHeading} tabIndex={-1}>
            {
              [
                entry.title,
                "Check your items",
                "Who’s sharing this bill?",
              ][step]
            }
          </h3>
          <p className="receipt-step-description">
            {
              [
                entry.description,
                "Check names and final costs. You can correct anything before sharing.",
                "Pick who's in and check what you paid.",
              ][step]
            }
          </p>
          {editor.syncError && processing && <p role="status">{editor.syncError}</p>}
          <fieldset disabled={running || !!draft.initializationRevision || (processing && step !== 1)}>
            {step === 0 && (
              <entry.Component draft={draft} setFile={setFile} replace={replace} setReplace={setReplace}
                scan={scan} update={editor.edit} setStep={editor.chooseStep} />
            )}
            {step === 1 && data.mode === "items" && (
              <ReceiptItemsStep draft={draft} unassignedTaxMessage={unassignedTaxMessage} replace={replace}
                setReplace={setReplace} scan={scan} update={editor.edit} confirmItem={editor.confirmItem}
                openReceipt={() => editor.chooseStep(0)} />
            )}
            {step === 2 && (
              <ReceiptSharingStep data={data} group={group} ownId={me.id} update={editor.edit} setStep={editor.chooseStep}
                notesOpen={notesOpen} setNotesOpen={setNotesOpen} enteringTotal={enteringTotal}
                setEnteringTotal={setEnteringTotal} splitLegendId={splitLegendId} />
            )}
          </fieldset>
          {/* The crop is a modal dialog; outside the fieldset its controls stay
              enabled whatever state disables the step form behind it. */}
          {file && (
            <ReceiptCrop
              key={`${file.name}:${file.lastModified}`}
              file={file}
              cancel={() => setFile(null)}
              save={async (base64) => {
                setFile(null);
                // As with the scan buttons, a completed scan leaves the replacement choice.
                void editor.cropPhoto(base64).then((scanned) => { if (scanned) setReplace(false); });
              }}
            />
          )}
          {step === 2 && unassignedTaxMessage && (
            <Notification tone="error" title="Receipt tax needs an item">
              <p>{unassignedTaxMessage}</p>
              <Button variant="text" onClick={() => editor.chooseStep(1)} disabled={running || processing}>
                Edit items <ArrowRight size={16} aria-hidden="true" />
              </Button>
            </Notification>
          )}
          {state.warnings.map((w, i) => (
            <Notification tone="warning" title="Check the receipt" key={i}>
              {w}
            </Notification>
          ))}
          {state.error && (
            <Notification tone="error" title="Draft needs attention">
              <p>{state.error}</p>
              <Button
                variant="text"
                onClick={() => void editor.reload().then((reloaded) => { if (reloaded) setFile(null); })}
              >
                Reload saved draft, discarding local edits
              </Button>
            </Notification>
          )}
          <p role="status">{activityLabels[state.operation] ?? state.notice}</p>
          {draft.initializationRevision && (
            <p>We didn't hear back. Retrying sends the same bill.</p>
          )}

          <div className={`receipt-wizard-actions${step === 1 ? " receipt-review-footer" : ""}`}>
            {step === 1 && <ReceiptReconciliation data={data} processing={processing} openSummary={() => setSummaryOpen(true)} />}
            <div>
              {step > 0 && (
                <Button
                  variant="text"
                  disabled={locked}
                  onClick={() =>
                    editor.chooseStep(step === 2 && data.mode === "manual" ? 0 : (step - 1) as Step)
                  }
                >
                  <ArrowLeft size={16} aria-hidden="true" /> Back
                </Button>
              )}
              <Button
                variant="text"
                disabled={locked}
                onClick={() => void editor.saveAndClose()}
              >
                Save draft & close
              </Button>
              {id && (
                <Button
                  variant="text"
                  className="draft-delete-text"
                  disabled={locked}
                  onClick={() => setConfirmDelete(true)}
                >
                  <Trash2 size={16} /> Delete draft
                </Button>
              )}
            </div>
            {step === 1 && (
              <Button onClick={() => editor.chooseStep(2)} disabled={running || processing || !canOpenStep(data, 2)}>
                Continue to sharing <ArrowRight size={16} aria-hidden="true" />
              </Button>
            )}
            {step === 2 && (
              <Button type="submit" disabled={running || !shareable(state)}>
                {draft.initializationRevision ? "Retry sharing" : "Share bill"}
                <ArrowRight size={16} aria-hidden="true" />
              </Button>
            )}
          </div>
          {step === 1 && !processing && !canOpenStep(data, 2) && (
            <p className="receipt-step-description">
              {!data.items.length
                ? "Add at least one item to continue."
                : !itemsComplete(data)
                  ? "Give every item a name and a price to continue."
                  : "Assign the receipt tax to an item to continue."}
            </p>
          )}
        </form>
      )}
    </div>
  );
  return (
    <>
      {form}
      {step === 0 && <PrototypeSwitcher variants={entryVariants} current={entry.key} />}
      {summaryOpen && <ReceiptSummary data={data} disabled={locked} change={editor.edit} close={() => setSummaryOpen(false)} />}
      {editor.leavingTo && (
        <DiscardChangesDialog saved={draft.revision > 0} keepEditing={editor.keepEditing} discard={editor.discard} />
      )}
      {confirmDelete && (
        <DeleteDraftDialog
          title={draft.data.title || ""}
          busy={running}
          cancel={() => setConfirmDelete(false)}
          remove={() => void editor.remove().then((deleted) => { if (!deleted) setConfirmDelete(false); })}
        />
      )}
    </>
  );
}

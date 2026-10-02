import { type Bill } from "@share-tally/domain/contracts/bills";
import { type ReceiptData, type ReceiptDraft } from "@share-tally/domain/contracts/receipts";
import { ArrowLeft, ArrowRight, Check, Trash2, Upload } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { BillApiError } from "../../../shared/api/bill-error";
import { errorMessage } from "../../../shared/api/error-message";
import { blockRouteNavigation, replaceRoute } from "../../../shared/browser/route";
import { Button } from "../../../shared/ui/Button";
import Dialog from "../../../shared/ui/Dialog";
import { Notification } from "../../../shared/ui/Notification";
import { type GroupDetail } from "../../groups/api";
import { useReceiptApi } from "../api";
import { ReceiptCrop } from "../photos/ReceiptCrop";
import { ReceiptPhoto } from "../photos/ReceiptPhoto";
import { deriveReceiptItems, recoverReceiptData, unassignedReceiptTaxMessage } from "../pricing/receipt-pricing";
import { ReceiptReconciliation, ReceiptReviewItems, ReceiptSummary } from "../review/ReceiptReview";
import { DeleteDraftDialog } from './DeleteDraftDialog';
import { canOpenStep, comparable, emptyDraft, hasUnsavedChanges, itemsComplete, itemsReady, openingStep } from './draft-model';
import { useReceiptDraftSync } from "./receipt-draft-sync";
import { ReceiptSharingStep } from './ReceiptSharingStep';
import { ReceiptSourceStep } from './ReceiptSourceStep';
import { ScanActions } from './ScanActions';

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
  const api = useReceiptApi();
  const me = group.members.find((m) => m.isCurrentUser)!;
  const createdRef = useRef(created);
  useEffect(() => {
    createdRef.current = created;
  }, [created]);
  const key = `receipt-draft:${me.id}:${group.id}:${id ?? "new"}`;
  const [draft, setDraft] = useState<ReceiptDraft>(() => {
    try {
      const stored = sessionStorage.getItem(key);
      if (stored) {
        const recovered = JSON.parse(stored) as ReceiptDraft;
        return { ...recovered, data: recoverReceiptData(recovered.data) };
      }
    } catch {
      /* Saved server draft remains available. */
    }
    return emptyDraft(me.id, id);
  });
  const baseline = useRef<ReceiptDraft | null>(
    id ? null : emptyDraft(me.id, draft.id),
  );
  const [discard, setDiscard] = useState(false);
  const [leaveTo, setLeaveTo] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const recoveredDraft = useRef(draft.revision > 0 ? draft : null);
  const [loading, setLoading] = useState(!!id);
  const stepKey = `receipt-step:${me.id}:${draft.id}`;
  const [step, setStep] = useState(() => openingStep(draft, sessionStorage.getItem(stepKey)));
  const stepHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (loading) return;
    sessionStorage.setItem(stepKey, String(step));
    window.scrollTo({ top: 0 });
    stepHeading.current?.focus({ preventScroll: true });
  }, [step, stepKey, loading]);
  const [busy, setBusy] = useState("");
  const pending = useRef(false);
  const ended = useRef(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [notesOpen, setNotesOpen] = useState(false);
  // Split by item, an empty total paid follows the items; this shows its input anyway.
  const [enteringTotal, setEnteringTotal] = useState(false);
  const [replace, setReplace] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [syncError, setSyncError] = useState("");
  const applyProcessingDraft = useCallback((drafts: ReceiptDraft[]) => {
    const latest = drafts[0];
    if (!latest) return;
    if (latest.processingStatus === "processing" && latest.data.mode === "items") setStep(1);
    setDraft((current) => {
      // Keep the original idempotent initiation revision if its response was lost.
      if (current.initializationRevision || latest.revision <= current.revision) return current;
      const clean = !current.pendingPhoto && baseline.current &&
        comparable(current.data) === comparable(baseline.current.data);
      // A scan always wins: the server rejects edits while it is processing.
      // Otherwise preserve unrelated local edits for the normal revision conflict.
      if (!clean && latest.processingStatus !== "processing" &&
        current.processingStatus !== "processing") return current;
      baseline.current = latest;
      return latest;
    });
  }, []);
  useReceiptDraftSync(group.id, draft.id, applyProcessingDraft, setSyncError,
    draft.revision > 0 && !loading);
  useEffect(() => {
    if (!id) return;
    let live = true;
    api
      .get(id)
      .then((r) => {
        if (live) {
          if (r.draft.billId) {
            void api
              .initialize(r.draft.id, r.draft.revision)
              .then((result) => createdRef.current(result.bill))
              .catch((e) => setError(errorMessage(e)));
          } else {
            baseline.current = r.draft;
            const local = recoveredDraft.current;
            let opened = r.draft;
            if (
              local?.id === r.draft.id &&
              r.draft.processingStatus !== "processing" &&
              local.processingStatus !== "processing" &&
              local.revision === r.draft.revision &&
              (local.initializationRevision ||
                comparable(local.data) !== comparable(r.draft.data) ||
                local.pendingPhoto)
            ) {
              // Keep the base revision so a newer server edit still triggers the save conflict check.
              opened = {
                ...local,
                photo: local.pendingPhoto ? local.photo : r.draft.photo,
              };
              setNotice(
                local.revision === r.draft.revision
                  ? "Recovered your unsaved changes."
                  : "Recovered your local changes. The saved draft has changed elsewhere; saving will check for a conflict.",
              );
            }
            setDraft(opened);
            setStep(openingStep(opened, sessionStorage.getItem(stepKey)));
          }
          setLoading(false);
        }
      })
      .catch((e) => {
        if (live) {
          setError(errorMessage(e));
          setLoading(false);
        }
      });
    return () => {
      live = false;
    };
  }, [api, id, stepKey]);
  useEffect(() => {
    if (!loading && !ended.current) {
      try {
        sessionStorage.setItem(key, JSON.stringify(draft));
      } catch {
        sessionStorage.removeItem(key);
      } // Large photos may exceed browser storage; keep editing in memory.
    }
  }, [draft, key, loading]);
  function clearLocal() {
    ended.current = true;
    sessionStorage.removeItem(key);

    const newKey = `receipt-draft:${me.id}:${group.id}:new`;
    try {
      const stored = JSON.parse(sessionStorage.getItem(newKey) ?? "null");
      if (stored?.id === draft.id) sessionStorage.removeItem(newKey);
    } catch {
      /* Ignore invalid local drafts. */
    }
  }
  function update(patch: Partial<ReceiptData>) {
    if (draft.processingStatus === "processing") return;
    setDraft((d) => {
      const data = { ...d.data, ...patch };
      return { ...d, data: data.mode === "items" ? { ...data, items: deriveReceiptItems(data) } : data };
    });
    setNotice("");
  }
  async function run(label: string, action: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true;
    setBusy(label);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      pending.current = false;
      setBusy("");
    }
  }
  async function save() {
    const { draft: saved } = await api.save(group.id, draft);
    setDraft(saved);
    baseline.current = saved;
    return saved;
  }
  function closeEditor(destination: string | null = null) {
    if (pending.current) return;
    // The server read has not yet established whether local recovery differs.
    if (loading) { close(); return; }
    if (hasUnsavedChanges(draft, baseline.current, file, loading)) {
      setLeaveTo(destination);
      setDiscard(true);
    } else {
      clearLocal();
      close();
    }
  }
  useEffect(() => {
    const isDirty = () => hasUnsavedChanges(draft, baseline.current, file, loading);
    const unblock = blockRouteNavigation((destination) => {
      if (ended.current) return false;
      if (pending.current) return true;
      if (loading) return false; // Preserve recovery until the server read completes.
      if (!isDirty()) {
        ended.current = true;
        sessionStorage.removeItem(key);
        return false;
      }
      setLeaveTo(destination);
      setDiscard(true);
      return true;
    });
    const warn = (event: BeforeUnloadEvent) => {
      if (!isDirty()) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => { unblock(); window.removeEventListener("beforeunload", warn); };
  }, [draft, file, key, loading]);
  async function scan(value = draft) {
    // Save both the draft and photo first: the saved scan owns the Azure result.
    const { draft: saved } = await api.save(group.id, value);
    setDraft(saved);
    baseline.current = saved;
    const { draft: scanned, extraction } = await api.extract(saved.id, saved.revision);
    setDraft((current) => {
      // Completion can arrive over the stream before the scan response.
      if (scanned.revision < current.revision) return current;
      baseline.current = scanned;
      return scanned;
    });
    setWarnings(extraction.warnings);
    setReplace(false);
    setStep(1);
  }
  const data = draft.data;
  const processing = draft.processingStatus === "processing";
  const itemTotal = data.items.reduce((sum, i) => sum + (i.finalCents ?? 0), 0);
  const unassignedTaxMessage = unassignedReceiptTaxMessage(data);
  // Initialization makes a followed total the item total.
  const paidCents = data.mode === "items" ? data.totalCents ?? itemTotal : data.totalCents;
  const valid =
    paidCents !== null &&
    paidCents > 0 &&
    data.title.trim() &&
    (data.mode === "manual" || itemsComplete(data));
  const splitLegendId = useId();
  const stepOpen = (index: number) =>
    !(index === 1 && data.mode === "manual") &&
    (index <= step || canOpenStep(data, index));
  const stepDone = [step > 0, step > 1 && itemsReady(data), false];
  const editor = (
    <div className="receipt-wizard">
      <header className="receipt-page-heading">
        <Button variant="text" onClick={() => closeEditor()}> <ArrowLeft size={18} aria-hidden="true" /> Back to group</Button>
        <div className="eyebrow">SHARETALLY / NEW BILL</div>
        <h1>{id ? "Continue your draft" : "New bill"} <span>· {group.name}</span></h1>
      </header>
      {loading ? (
        <p>Opening draft…</p>
      ) : (
        <form
          className="bill-form"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (processing || step !== 2 || unassignedTaxMessage || !e.currentTarget.reportValidity()) return;
            if (valid)
              void run("Sharing…", async () => {
                const saved = draft.initializationRevision
                  ? draft
                  : await save();
                const revision = saved.initializationRevision ?? saved.revision;
                setDraft({ ...saved, initializationRevision: revision });
                try {
                  const result = await api.initialize(saved.id, revision);
                  clearLocal();
                  sessionStorage.removeItem(stepKey);
                  created(result.bill);
                } catch (e) {
                  if (e instanceof BillApiError && e.status < 500)
                    setDraft({ ...saved, initializationRevision: undefined });
                  throw e;
                }
              });
          }}
        >
          <nav aria-label="New bill steps" className="receipt-steps">
            {["Receipt", "Items", "People"].map(
              (label, index) => (
                <button
                  type="button"
                  key={label}
                  aria-current={step === index ? "step" : undefined}
                  disabled={
                    !!busy ||
                    !!draft.initializationRevision ||
                    processing ||
                    !stepOpen(index)
                  }
                  onClick={() => setStep(index)}
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
                "Start with your receipt",
                "Check your items",
                "Who’s sharing this bill?",
              ][step]
            }
          </h3>
          <p className="receipt-step-description">
            {
              [
                "Use a receipt to fill in the items, or enter them yourself.",
                "Check names and final costs. You can correct anything before sharing.",
                "Pick who's in and check what you paid.",
              ][step]
            }
          </p>
          {syncError && processing && <p role="status">{syncError}</p>}
          <fieldset disabled={!!busy || !!draft.initializationRevision || (processing && step !== 1)}>
            {step === 0 && (
              <ReceiptSourceStep draft={draft} setFile={setFile} replace={replace} setReplace={setReplace}
                scan={() => void run("Reading receipt…", scan)} update={update} setStep={setStep} />
            )}
            {step === 1 && data.mode === "items" && (
              <>
                <div
                  className={`receipt-review-layout${draft.photo ? "" : " receipt-without-photo"}`}
                >
                  <div className="receipt-photo-panel">
                    {draft.photo && (
                      <ReceiptPhoto
                        id={draft.id}
                        version={draft.revision}
                        localPhoto={draft.pendingPhoto}
                        expired={draft.photo.expired}
                        review
                      />
                    )}

                    <Button variant="secondary" disabled={processing} onClick={() => setStep(0)}>
                      <Upload size={18} aria-hidden="true" />
                      {draft.photo
                        ? "Replace receipt photo"
                        : "Use a receipt photo"}
                    </Button>
                  </div>
                  <div>
                    {draft.photo && !draft.photo.expired && (
                      <ScanActions hasItems={data.items.length > 0} replace={replace} setReplace={setReplace} scan={() => void run("Reading receipt…", scan)} disabled={processing} />
                    )}
                    {unassignedTaxMessage && !processing && (
                      <Notification tone="error" title="Receipt tax needs an item">
                        {unassignedTaxMessage}
                      </Notification>
                    )}
                    <ReceiptReviewItems
                      items={data.items}
                      change={(items) => update({ items })}
                      processing={processing}
                      processingStatus={draft.processingStatus}
                      scanned={!!draft.photo && data.items.length > 0}
                      onConfirm={async (itemId, flag) => {
                        if (pending.current || draft.processingStatus === "processing") return false;
                        pending.current = true;
                        setBusy("Confirming item…");
                        setError("");
                        try {
                          const latest = hasUnsavedChanges(draft, baseline.current, file, loading)
                            ? (await api.save(group.id, draft)).draft : draft;
                          const confirmed = latest.data.items.find((item) => item.id === itemId)?.[flag] === false
                            ? latest : (await api.confirmItem(latest.id, itemId, latest.revision, flag)).draft;
                          baseline.current = confirmed;
                          setDraft(confirmed);
                          setNotice("");
                          return true;
                        } catch (error) {
                          setError(errorMessage(error));
                          return false;
                        } finally {
                          pending.current = false;
                          setBusy("");
                        }
                      }}
                      photo={draft.photo && !draft.photo.expired && !draft.pendingPhoto
                        ? { id: draft.id, version: draft.revision, pages: data.receipt?.evidence?.pages }
                        : undefined}
                    />
                  </div>
                </div>
              </>
            )}
            {step === 2 && (
              <ReceiptSharingStep data={data} group={group} ownId={me.id} update={update} setStep={setStep}
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
                const next = {
                  ...draft,
                  pendingPhoto: base64,
                  photo: { expiresAt: "", expired: false },
                };
                setDraft(next);
                setNotice("");
                setFile(null);
                void run("Reading receipt…", () => scan(next));
              }}
            />
          )}
          {step === 2 && unassignedTaxMessage && (
            <Notification tone="error" title="Receipt tax needs an item">
              <p>{unassignedTaxMessage}</p>
              <Button variant="text" onClick={() => setStep(1)} disabled={!!busy || processing}>
                Edit items <ArrowRight size={16} aria-hidden="true" />
              </Button>
            </Notification>
          )}
          {warnings.map((w, i) => (
            <Notification tone="warning" title="Check the receipt" key={i}>
              {w}
            </Notification>
          ))}
          {error && (
            <Notification tone="error" title="Draft needs attention">
              <p>{error}</p>
              <Button
                variant="text"
                onClick={() =>
                  void run("Reloading…", async () => {
                    const result = await api.get(draft.id);
                    setDraft(result.draft);
                    baseline.current = result.draft;
                    setStep(openingStep(result.draft, sessionStorage.getItem(stepKey)));
                    setFile(null);
                  })
                }
              >
                Reload saved draft, discarding local edits
              </Button>
            </Notification>
          )}
          <p role="status">{busy || notice}</p>
          {draft.initializationRevision && (
            <p>We didn't hear back. Retrying sends the same bill.</p>
          )}

          <div className={`receipt-wizard-actions${step === 1 ? " receipt-review-footer" : ""}`}>
            {step === 1 && <ReceiptReconciliation data={data} processing={processing} openSummary={() => setSummaryOpen(true)} />}
            <div>
              {step > 0 && (
                <Button
                  variant="text"
                  disabled={!!busy || !!draft.initializationRevision || processing}
                  onClick={() =>
                    setStep(step === 2 && data.mode === "manual" ? 0 : step - 1)
                  }
                >
                  <ArrowLeft size={16} aria-hidden="true" /> Back
                </Button>
              )}
              <Button
                variant="text"
                disabled={!!busy || !!draft.initializationRevision || processing}
                onClick={() =>
                  void run("Saving draft…", async () => {
                    await save();
                    clearLocal();
                    close();
                  })
                }
              >
                Save draft & close
              </Button>
              {id && (
                <Button
                  variant="text"
                  className="draft-delete-text"
                  disabled={!!busy || !!draft.initializationRevision || processing}
                  onClick={() => setDeleting(true)}
                >
                  <Trash2 size={16} /> Delete draft
                </Button>
              )}
            </div>
            {step === 1 && (
              <Button onClick={() => setStep(2)} disabled={!!busy || processing || !canOpenStep(data, 2)}>
                Continue to sharing <ArrowRight size={16} aria-hidden="true" />
              </Button>
            )}
            {step === 2 && (
              <Button type="submit" disabled={!!busy || !valid || processing || !!unassignedTaxMessage}>
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
      {editor}
      {summaryOpen && <ReceiptSummary data={data} disabled={!!busy || !!draft.initializationRevision || processing} change={update} close={() => setSummaryOpen(false)} />}
      {discard && (
        <Dialog
          title="Discard unsaved changes?"
          kicker="BEFORE YOU CLOSE"
          close={() => { setDiscard(false); setLeaveTo(null); }}
        >
          <p>
            {draft.revision > 0
              ? "Only unsaved edits will be discarded. Your last saved draft, including its saved receipt scan and photo, will stay as it was."
              : "This bill has not been saved. Its unsaved details and receipt photo will be discarded."}
          </p>
          <div className="dialog-actions">
            <Button variant="secondary" onClick={() => { setDiscard(false); setLeaveTo(null); }}>
              Keep editing
            </Button>
            <Button
              className="draft-danger"
              onClick={() => {
                clearLocal();
                if (leaveTo) replaceRoute(leaveTo);
                else close();
              }}
            >
              Discard changes
            </Button>
          </div>
        </Dialog>
      )}
      {deleting && (
        <DeleteDraftDialog
          title={draft.data.title || ""}
          busy={!!busy}
          cancel={() => setDeleting(false)}
          remove={() =>
            void run("Deleting…", async () => {
              try {
                await api.remove(draft.id, draft.revision);
                clearLocal();
                close();
              } catch (e) {
                setDeleting(false);
                throw e;
              }
            })
          }
        />
      )}
    </>
  );
}

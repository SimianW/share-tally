import { requestId } from "./request-id";
import { useCallback, useEffect, useRef, useState } from "react";
import { useReceiptDraftSync } from "./receipt-draft-sync";
import { BillApiError, localToday, money, type Bill } from "./bill-api";
import { errorMessage, useGroupApi, type GroupDetail } from "./group-api";
import { blockRouteNavigation, replaceRoute } from "./route";
import {
  useReceiptApi,
  type ReceiptDraft,
  type ReceiptData,
} from "./receipt-api";
import { ReceiptAmount } from "./ReceiptAmount";
import { ReceiptReviewItems, ReceiptSummary, ReceiptReconciliation } from "./ReceiptReview";
import { deriveReceiptItems, recoverReceiptData, unassignedReceiptTaxMessage } from "./receipt-pricing";
import { ReceiptCrop, ReceiptPhoto } from "./ReceiptPhoto";
import Dialog from "./Dialog";
import { Notification } from "./Notification";
import { Button } from "./ui";
import { ParticipantPicker } from "./ParticipantPicker";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Camera,
  Upload,
  ReceiptText,
  PencilLine,
  Trash2,
  FilePenLine,
  LockKeyhole,
  ListChecks,
  CircleDollarSign,
} from "lucide-react";
import "./receipts.css";
import "./receipt-review.css";

function comparable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(comparable).join(",")}]`;
  if (value && typeof value === "object")
    return JSON.stringify(
      Object.keys(value)
        .sort()
        .map((key) => [
          key,
          comparable((value as Record<string, unknown>)[key]),
        ]),
    );
  return JSON.stringify(value);
}

function hasUnsavedChanges(draft: ReceiptDraft, baseline: ReceiptDraft | null, file: File | null, loading: boolean) {
  return !loading && !draft.initializationRevision && (
    !!file || !!draft.pendingPhoto || !baseline ||
    comparable(draft.data) !== comparable(baseline.data)
  );
}

function itemsComplete(data: ReceiptData) {
  return data.items.length > 0 && data.items.every(
    (i) =>
      i.amountCents !== null &&
      i.finalCents !== null &&
      i.finalCents >= 0 &&
      i.name.trim(),
  );
}

// Items are ready for sharing when initiation would accept them: every item is
// complete and the receipt tax is assigned to at least one of them.
function itemsReady(data: ReceiptData) {
  return data.mode === "items" && itemsComplete(data) && !unassignedReceiptTaxMessage(data);
}

// Later steps open only once the steps before them are done; Items needs a
// scanned or entered item, People needs manual shares or ready items.
function canOpenStep(data: ReceiptData, index: number) {
  if (index === 0) return true;
  if (index === 1) return data.mode === "items" && data.items.length > 0;
  return data.mode === "manual" || itemsReady(data);
}

function openingStep(draft: ReceiptDraft, stored: string | null) {
  if (draft.initializationRevision) return 2;
  if (draft.processingStatus === "processing" && draft.data.mode === "items") return 1;
  if (stored !== null && [0, 1, 2].includes(Number(stored)) && canOpenStep(draft.data, Number(stored)))
    return Number(stored);
  return draft.data.mode === "manual" ? 2 : draft.data.items.length ? 1 : 0;
}

function clearDeletedDraft(id: string) {
  for (const key of Object.keys(sessionStorage)) {
    if (key.startsWith("receipt-step:") && key.endsWith(`:${id}`))
      sessionStorage.removeItem(key);
    if (!key.startsWith("receipt-draft:")) continue;
    try {
      if (JSON.parse(sessionStorage.getItem(key) ?? "null")?.id === id)
        sessionStorage.removeItem(key);
    } catch {
      /* Ignore unrelated invalid recovery entries. */
    }
  }
}

function DeleteDraftDialog({
  title,
  busy,
  cancel,
  remove,
}: {
  title: string;
  busy: boolean;
  cancel: () => void;
  remove: () => void;
}) {
  return (
    <Dialog
      title="Delete this draft?"
      kicker="PRIVATE DRAFT"
      close={() => {
        if (!busy) cancel();
      }}
    >
      <p>
        <strong>{title || "Untitled bill"}</strong>
      </p>
      <p>
        This deletes the draft and any attached receipt photo. Group bills and
        balances will not change. This cannot be undone.
      </p>
      <div className="dialog-actions">
        <Button variant="secondary" disabled={busy} onClick={cancel}>
          Keep draft
        </Button>
        <Button className="draft-danger" disabled={busy} onClick={remove}>
          {busy ? "Deleting…" : "Delete draft"}
        </Button>
      </div>
    </Dialog>
  );
}

export function ReceiptDrafts({
  groupId,
  open,
}: {
  groupId: string;
  open: (id: string) => void;
}) {
  const api = useReceiptApi();
  const [drafts, setDrafts] = useState<ReceiptDraft[]>([]);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [deleting, setDeleting] = useState<ReceiptDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const applyDrafts = useCallback((updated: ReceiptDraft[]) => {
    setDrafts(updated);
    setError("");
  }, []);
  useReceiptDraftSync(groupId, null, applyDrafts, setError, true, retry);
  return (
    <section className="receipt-drafts">
      {drafts.length > 0 && (
        <>
          <h3>
            Your drafts <small>{drafts.length}</small>
          </h3>
          <p className="draft-private">
            <LockKeyhole size={14} /> Only you can see these. They do not affect
            group balances.
          </p>
        </>
      )}
      {drafts.map((d) => (
        <div className="draft-list-row" key={d.id}>
          <FilePenLine className="draft-list-icon" size={24} />
          <div className="draft-list-copy">
            <strong>{d.data.title || "Untitled bill"}</strong>
            <small>
              {d.data.mode === "items" ? "Split by items" : "Split by amount"}
              {d.processingStatus === "processing" && <span className="draft-processing-status"> · Checking names & tax…</span>}
              {d.processingStatus === "fallback" && " · Tax not checked"}
              {d.updatedAt &&
                ` · Saved ${new Date(d.updatedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`}
            </small>
          </div>
          <span className="draft-list-total">
            {d.data.totalCents === null
              ? "Total not entered"
              : money(d.data.totalCents)}
          </span>
          <Button variant="secondary" className="small" onClick={() => open(d.id)}>
            Continue <ArrowRight size={16} />
          </Button>
          <button
            className="draft-delete"
            aria-label={`Delete ${d.data.title || "untitled bill"}`}
            disabled={d.processingStatus === "processing"}
            onClick={() => {
              setError("");
              setDeleting(d);
            }}
          >
            <Trash2 size={18} />
          </button>
        </div>
      ))}
      {deleting && (
        <DeleteDraftDialog
          title={deleting.data.title}
          busy={busy}
          cancel={() => setDeleting(null)}
          remove={() => {
            setBusy(true);
            setError("");
            void api
              .remove(deleting.id, deleting.revision)
              .then(() => {
                clearDeletedDraft(deleting.id);
                setDrafts((ds) => ds.filter((d) => d.id !== deleting.id));
                setDeleting(null);
              })
              .catch((e) => {
                setError(errorMessage(e));
                setDeleting(null);
                setRetry((n) => n + 1);
              })
              .finally(() => setBusy(false));
          }}
        />
      )}
      {error && (
        <p role="alert">
          {error}{" "}
          <Button onClick={() => setRetry((n) => n + 1)}>Retry drafts</Button>
        </p>
      )}
    </section>
  );
}

function emptyDraft(userId: string, id = requestId()): ReceiptDraft {
  return {
    id,
    revision: 0,
    processingStatus: "ready",
    processingStartedAt: null,
    data: {
      mode: "items",
      title: "",
      purchaseDate: localToday(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      notes: "",
      totalCents: null,
      ownShareCents: 0,
      participantIds: [userId],
      items: [],
      receipt: {
        subtotalCents: null,
        taxCents: 0,
        discountCents: 0,
        extraCents: 0,
        pricesIncludeTax: false,
      },
    },
  };
}

export function NewBillPage({ groupId, draftId }: { groupId: string; draftId?: string }) {
  const api = useGroupApi();
  const [group, setGroup] = useState<GroupDetail | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let live = true;
    api.detail(groupId).then(({ group }) => {
      if (live) { setGroup(group); setError(""); }
    }).catch((e) => { if (live) setError(errorMessage(e)); });
    return () => { live = false; };
  }, [api, groupId, retry]);
  return <section className="receipt-page">
    {error && <Notification tone="error" title="Could not open this group"><p>{error}</p><Button onClick={() => setRetry(n => n + 1)}>Try again</Button></Notification>}
    {!group && !error && <p role="status">Opening group…</p>}
    {group && <ReceiptDraftForm group={group} id={draftId} close={() => { window.location.hash = `/group-bills/${groupId}`; }} created={bill => { window.location.hash = `/bills/${bill.id}`; }} />}
  </section>;
}

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
  const cameraInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const pending = useRef(false);
  const ended = useRef(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [notesOpen, setNotesOpen] = useState(false);
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
    setNotice("Unsaved changes");
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
  const valid =
    data.totalCents !== null &&
    data.totalCents > 0 &&
    data.title.trim() &&
    (data.mode === "manual"
      ? data.ownShareCents <= data.totalCents
      : itemsComplete(data));
  const canSplitByItem = itemsReady({ ...data, mode: "items" });
  const missing = [
    !data.title.trim() && "a bill title",
    !(data.totalCents !== null && data.totalCents > 0) && "the total paid",
    data.mode === "items" && !itemsComplete(data) && "item names and prices",
  ].filter(Boolean);
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
              <>
                <div className="receipt-source">
                  <ReceiptText size={32} aria-hidden="true" />
                  <h4>
                    {draft.photo
                      ? "Your receipt"
                      : "Bring in your shopping list"}
                  </h4>
                  <p>Choose an image, crop it, then read the receipt.</p>
                  <div
                    className="receipt-upload"
                    role="group"
                    aria-label="Add a receipt photo"
                  >
                    <input
                      ref={cameraInput}
                      hidden
                      type="file"
                      aria-label="Take a receipt photo"
                      accept="image/jpeg,image/png,image/webp"
                      capture="environment"
                      onChange={(e) => {
                        setFile(e.target.files?.[0] ?? null);
                        e.currentTarget.value = "";
                      }}
                    />
                    <input
                      ref={fileInput}
                      hidden
                      type="file"
                      aria-label="Choose a receipt image"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={(e) => {
                        setFile(e.target.files?.[0] ?? null);
                        e.currentTarget.value = "";
                      }}
                    />
                    <Button
                      variant="secondary"
                      className="receipt-camera-button"
                      onClick={() => cameraInput.current?.click()}
                    >
                      <Camera size={20} strokeWidth={1.8} aria-hidden="true" />
                      Take a picture
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => fileInput.current?.click()}
                    >
                      <Upload size={20} strokeWidth={1.8} aria-hidden="true" />
                      Choose file
                    </Button>
                  </div>
                  {draft.photo && (
                    <ReceiptPhoto
                      id={draft.id}
                      version={draft.revision}
                      localPhoto={draft.pendingPhoto}
                      expired={draft.photo.expired}
                    />
                  )}
                  {draft.photo && !draft.photo.expired && (
                    <div className="receipt-scan-actions">
                      {data.items.length > 0 && !replace ? (
                        <Button
                          variant="secondary"
                          onClick={() => setReplace(true)}
                        >
                          Scan and replace current items…
                        </Button>
                      ) : (
                        <Button
                          variant="secondary"
                          onClick={() => void run("Reading receipt…", scan)}
                        >
                          {replace
                            ? "Replace current items with a new scan"
                            : "Read receipt"}
                        </Button>
                      )}
                      {replace && (
                        <Button
                          variant="secondary"
                          onClick={() => setReplace(false)}
                        >
                          Keep current items
                        </Button>
                      )}
                    </div>
                  )}
                </div>
                <div className="receipt-entry-alternative">
                  <span>or</span>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      update({ mode: "items" });
                      setStep(1);
                    }}
                  >
                    <PencilLine size={18} aria-hidden="true" /> Enter items
                    myself
                  </Button>
                  <Button
                    variant="text"
                    onClick={() => {
                      update({ mode: "manual", ownShareCents: 0 });
                      setStep(2);
                    }}
                  >
                    Split by amount instead
                  </Button>
                </div>
              </>
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
                      <div className="receipt-scan-actions">
                        {data.items.length > 0 && !replace ? (
                          <Button
                            variant="secondary"
                            disabled={processing}
                            onClick={() => setReplace(true)}
                          >
                            Scan and replace current items…
                          </Button>
                        ) : (
                          <Button
                            variant="secondary"
                            disabled={processing}
                            onClick={() => void run("Reading receipt…", scan)}
                          >
                            {replace
                              ? "Replace current items with a new scan"
                              : "Read receipt"}
                          </Button>
                        )}
                        {replace && (
                          <Button
                            variant="secondary"
                            onClick={() => setReplace(false)}
                          >
                            Keep current items
                          </Button>
                        )}
                      </div>
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
              <div className="receipt-sharing">
                <div className="sharing-details">
                  <label>
                    Bill title
                    <input
                      required
                      maxLength={120}
                      value={data.title}
                      onChange={(e) => update({ title: e.target.value })}
                    />
                  </label>
                  <label>
                    Purchase date
                    <input
                      required
                      type="date"
                      max={localToday()}
                      value={data.purchaseDate}
                      onChange={(e) => update({ purchaseDate: e.target.value })}
                    />
                  </label>
                </div>
                <ParticipantPicker
                  members={group.members}
                  selected={data.participantIds}
                  lockedId={me.id}
                  change={(participantIds) => update({ participantIds })}
                  shortcuts
                />
                <fieldset className="sharing-split">
                  <legend className="sharing-section-title">Split</legend>
                  <div className="split-toggle">
                    <label>
                      <input
                        type="radio"
                        name="split"
                        checked={data.mode === "items"}
                        disabled={data.mode !== "items" && !canSplitByItem}
                        onChange={() => update({ mode: "items", ownShareCents: 0 })}
                      />
                      <ListChecks size={17} aria-hidden="true" /> By item
                    </label>
                    <label>
                      <input
                        type="radio"
                        name="split"
                        checked={data.mode === "manual"}
                        onChange={() => update({ mode: "manual", ownShareCents: 0 })}
                      />
                      <CircleDollarSign size={17} aria-hidden="true" /> By amount
                    </label>
                  </div>
                  <p className="split-hint">
                    {data.mode === "items"
                      ? "Everyone picks the items they're in on."
                      : "Everyone enters their own share."}
                    {data.mode !== "items" && !canSplitByItem && (
                      <span> Add items first to split by item.</span>
                    )}
                  </p>
                  <div className="split-amounts">
                    <ReceiptAmount
                      label="Total paid (CAD)"
                      value={data.totalCents}
                      change={(totalCents) => update({ totalCents })}
                    />
                    {data.mode === "manual" && (
                      <ReceiptAmount
                        label="Your share (CAD)"
                        emptyAsZero
                        value={data.ownShareCents}
                        change={(ownShareCents) => {
                          if (ownShareCents !== null) update({ ownShareCents });
                        }}
                      />
                    )}
                  </div>
                  {data.mode === "manual" &&
                    data.totalCents !== null &&
                    data.ownShareCents > data.totalCents && (
                      <p role="alert" className="field-error">
                        Your share can't be more than the total paid.
                      </p>
                    )}
                  {data.mode === "items" && (
                    <div className="split-items">
                      <p>
                        {/* Claims round per person, so the final initiator adjustment
                            can differ from this draft-time difference by a few cents. */}
                        Items add up to {money(itemTotal)}
                        {data.totalCents !== null && data.totalCents > itemTotal &&
                          ` (${money(data.totalCents - itemTotal)} under the total paid)`}
                        {data.totalCents !== null && data.totalCents < itemTotal &&
                          ` (${money(itemTotal - data.totalCents)} over the total paid)`}
                        .
                        {data.totalCents !== null && data.totalCents !== itemTotal &&
                          " Any difference left after everyone claims goes to you."}
                      </p>
                      <Button variant="text" onClick={() => setStep(1)}>
                        Edit {data.items.length} items <ArrowRight size={16} aria-hidden="true" />
                      </Button>
                    </div>
                  )}
                </fieldset>
                {notesOpen || data.notes ? (
                  <label>
                    Notes
                    <textarea
                      maxLength={2000}
                      autoFocus={notesOpen && !data.notes}
                      value={data.notes}
                      onChange={(e) => update({ notes: e.target.value })}
                    />
                  </label>
                ) : (
                  <Button variant="text" className="sharing-add-note" onClick={() => setNotesOpen(true)}>
                    <PencilLine size={16} aria-hidden="true" /> Add a note
                  </Button>
                )}
                {missing.length > 0 && (
                  <p className="field-error">
                    Add {missing.length > 1 ? `${missing.slice(0, -1).join(", ")} and ${missing.at(-1)}` : missing[0]}.
                  </p>
                )}
              </div>
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
                setNotice("Unsaved changes");
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

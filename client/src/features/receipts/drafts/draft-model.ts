// The bill-draft editor's rules, without React or requests. The editor hook
// turns requests, live updates and recovery into these events.
import { type ReceiptData, type ReceiptDraft } from "@share-tally/domain/contracts/receipts";
import { hasUnassignedReceiptTax, priceReceiptDraft } from "@share-tally/domain/draft-pricing";
import { localToday } from "../../../shared/browser/date.ts";
import { requestId } from "../../../shared/browser/request-id.ts";

export type Step = 0 | 1 | 2;
/** One request activity at a time. `opening` waits for the saved draft; `ended` follows leaving or sharing. */
export type Operation =
  | "opening" | "idle" | "saving" | "scanning" | "confirming" | "reloading" | "deleting" | "initiating" | "ended";
export type Activity = Exclude<Operation, "opening" | "idle" | "ended">;

export type EditorState = {
  /** The newest draft the server has reported, whether or not it was adopted. */
  server: ReceiptDraft | null;
  /** The saved draft the local content started from; unsaved changes are measured against it. */
  baseline: ReceiptDraft | null;
  /** What the editor shows and recovers. */
  local: ReceiptDraft;
  step: Step;
  operation: Operation;
  error: string;
  notice: string;
  warnings: string[];
};

export type EditorEvent =
  | { type: "opened"; draft: ReceiptDraft; storedStep: string | null }
  | { type: "openFailed"; message: string }
  | { type: "reopened" }
  | { type: "removed"; message: string }
  | { type: "edited"; patch: Partial<ReceiptData> }
  | { type: "photoCropped"; base64: string }
  | { type: "stepChosen"; step: Step }
  | { type: "started"; operation: Activity }
  | { type: "saved"; draft: ReceiptDraft }
  | { type: "scanned"; draft: ReceiptDraft; warnings: string[] }
  | { type: "remoteDraft"; draft: ReceiptDraft }
  | { type: "initiationStarted"; draft: ReceiptDraft }
  | { type: "initiationRejected" }
  | { type: "reloaded"; draft: ReceiptDraft; storedStep: string | null }
  | { type: "finished" }
  | { type: "failed"; message: string }
  | { type: "ended" };

export function comparable(value: unknown): string {
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
export function itemsComplete(data: ReceiptData) {
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
export function itemsReady(data: ReceiptData) {
  return data.mode === "items" && itemsComplete(data) && !hasUnassignedReceiptTax(data);
}
// Later steps open only once the steps before them are done; Items needs a
// scanned or entered item, People needs By amount or ready items.
export function canOpenStep(data: ReceiptData, index: number) {
  if (index === 0) return true;
  if (index === 1) return data.mode === "items" && data.items.length > 0;
  return data.mode === "manual" || itemsReady(data);
}
export function openingStep(draft: ReceiptDraft, stored: string | null): Step {
  if (draft.initializationRevision) return 2;
  if (draft.processingStatus === "processing" && draft.data.mode === "items") return 1;
  if (stored !== null && [0, 1, 2].includes(Number(stored)) && canOpenStep(draft.data, Number(stored)))
    return Number(stored) as Step;
  return draft.data.mode === "manual" ? 2 : draft.data.items.length ? 1 : 0;
}
export function emptyDraft(userId: string, id = requestId()): ReceiptDraft {
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

/**
 * A saved draft opens after the server read, including a new bill whose recovered
 * copy was already saved by a scan; an unsaved new bill opens at once against an empty baseline.
 */
export function createEditor({ userId, draftId, recovered, storedStep }: {
  userId: string;
  draftId?: string;
  recovered: ReceiptDraft | null;
  storedStep: string | null;
}): EditorState {
  const local = recovered ?? emptyDraft(userId, draftId);
  const saved = !!draftId || local.revision > 0;
  return {
    server: null,
    baseline: saved ? null : emptyDraft(userId, local.id),
    local,
    step: openingStep(local, storedStep),
    operation: saved ? "opening" : "idle",
    error: "",
    notice: "",
    warnings: [],
  };
}

const processing = (draft: ReceiptDraft) => draft.processingStatus === "processing";
const newer = (known: ReceiptDraft | null, draft: ReceiptDraft) =>
  known && known.revision > draft.revision ? known : draft;

// Unsaved edits are recovered only against the saved revision they started from:
// an older entry never replaces a newer saved draft, and a scan always wins.
export function recoverable(recovered: ReceiptDraft | null, server: ReceiptDraft): recovered is ReceiptDraft {
  return !!recovered && recovered.id === server.id &&
    !processing(server) && !processing(recovered) &&
    recovered.revision === server.revision &&
    (!!recovered.initializationRevision ||
      comparable(recovered.data) !== comparable(server.data) ||
      !!recovered.pendingPhoto);
}

// A reply never replaces a newer draft already delivered over the live stream.
// An initiated draft stays locked behind its own revision, so only a retry can follow.
function adopt(state: EditorState, draft: ReceiptDraft): EditorState {
  const newest = newer(state.server, draft);
  const local = newest.billId ? { ...newest, initializationRevision: newest.revision } : newest;
  return { ...state, server: newest, baseline: newest, local, step: newest.billId ? 2 : state.step };
}

function clean(state: EditorState) {
  return !state.local.pendingPhoto && !!state.baseline &&
    comparable(state.local.data) === comparable(state.baseline.data);
}

/** Whether the server has confirmed what the editor holds: a saved draft once its read succeeds, or a new bill. */
export function opened(state: EditorState) {
  return !!state.baseline;
}

/** Only a draft the server has known can have been removed; a new bill never saved cannot. */
export function knownToServer(state: EditorState) {
  return !!state.server || state.local.revision > 0;
}

/** Editing needs a confirmed draft, no running request, no processing scan and no pending initiation. */
export function editable(state: EditorState) {
  return opened(state) && state.operation === "idle" && !processing(state.local) && !state.local.initializationRevision;
}

export function hasUnsavedChanges(state: EditorState, photoSelected = false) {
  const { local, baseline } = state;
  return !!baseline && state.operation !== "ended" && !local.initializationRevision && (
    photoSelected || !!local.pendingPhoto ||
    comparable(local.data) !== comparable(baseline.data)
  );
}

/**
 * Unloading warns about unsaved changes, and also while an opening (in flight or
 * failed) holds a saved draft's recovered copy: closing the tab would discard it.
 */
export function warnBeforeUnload(state: EditorState, photoSelected = false) {
  if (hasUnsavedChanges(state, photoSelected)) return true;
  return !opened(state) && state.operation !== "ended" && state.local.revision > 0;
}

/** What leaving the editor does: keep recovery while opening, stay during a request, or ask about unsaved changes. */
export function leaving(state: EditorState, photoSelected = false): "stay" | "leave" | "keep-recovery" | "ask" {
  if (state.operation === "ended") return "leave";
  // Until the server read succeeds, recovery has not been checked; leave it as it was.
  if (state.operation === "opening" || !opened(state)) return "keep-recovery";
  if (state.operation !== "idle") return "stay";
  return hasUnsavedChanges(state, photoSelected) ? "ask" : "leave";
}

/** The browser keeps unsaved local work, never a draft that is still opening or has ended. */
export function recoveryEntry(state: EditorState): ReceiptDraft | null {
  return !opened(state) || state.operation === "ended" ? null : state.local;
}

export function stepOpen(state: EditorState, index: number) {
  const { data } = state.local;
  return !(index === 1 && data.mode === "manual") && (index <= state.step || canOpenStep(data, index));
}

/** Step buttons move only while the editor is unlocked; a pending initiation stays on People. */
export function stepAvailable(state: EditorState, index: number) {
  return state.operation === "idle" && !processing(state.local) &&
    !state.local.initializationRevision && stepOpen(state, index);
}

export function paidCents(data: ReceiptData) {
  const itemTotal = data.items.reduce((sum, i) => sum + (i.finalCents ?? 0), 0);
  // Initialization makes a followed total the item total.
  return data.mode === "items" ? data.totalCents ?? itemTotal : data.totalCents;
}

/** Sharing needs the People step, a title, a positive total and, by item, ready items. */
export function shareable(state: EditorState) {
  const { data } = state.local;
  const paid = paidCents(data);
  return state.step === 2 && !processing(state.local) && paid !== null && paid > 0 &&
    !!data.title.trim() && (data.mode === "manual" || itemsComplete(data)) &&
    !(data.mode === "items" && hasUnassignedReceiptTax(data));
}

/** A retried initiation repeats the revision first sent, since its reply may have been lost. */
export function initiationRevision(state: EditorState) {
  return state.local.initializationRevision ?? state.local.revision;
}

function allowed(state: EditorState, operation: Activity) {
  if (state.operation !== "idle" || !opened(state)) return false;
  if (operation === "reloading") return true;
  if (processing(state.local)) return false;
  if (operation === "initiating") return shareable(state);
  return !state.local.initializationRevision;
}

export function reduceEditor(state: EditorState, event: EditorEvent): EditorState {
  switch (event.type) {
    case "opened": {
      if (state.operation !== "opening") return state;
      const server = event.draft;
      // Already initiated: never reopen it for editing; only its idempotent retry remains.
      if (server.billId) return { ...adopt(state, server), operation: "idle", notice: "" };
      const recovered = recoverable(state.local, server) ? state.local : null;
      // Keep the base revision so a newer server edit still triggers the save conflict check.
      const local = recovered
        ? { ...recovered, photo: recovered.pendingPhoto ? recovered.photo : server.photo }
        : server;
      return {
        ...state, server, baseline: server, local, operation: "idle",
        step: openingStep(local, event.storedStep),
        notice: recovered ? "Recovered your unsaved changes." : "",
      };
    }
    case "reopened":
      return !opened(state) && state.operation === "idle" ? { ...state, operation: "opening", error: "" } : state;
    case "openFailed":
      return state.operation === "opening" ? { ...state, operation: "idle", error: event.message } : state;
    case "removed":
      return { ...state, operation: "ended", error: event.message, notice: "" };
    case "edited": {
      if (!editable(state)) return state;
      const data = { ...state.local.data, ...event.patch };
      const priced = data.mode === "items" ? { ...data, items: priceReceiptDraft(data).items } : data;
      return { ...state, local: { ...state.local, data: priced }, notice: "" };
    }
    case "photoCropped":
      if (!editable(state)) return state;
      return {
        ...state, notice: "",
        local: { ...state.local, pendingPhoto: event.base64, photo: { expiresAt: "", expired: false } },
      };
    case "stepChosen":
      return editable(state) ? { ...state, step: event.step } : state;
    case "started":
      return allowed(state, event.operation) ? { ...state, operation: event.operation, error: "" } : state;
    case "saved":
      return { ...adopt(state, event.draft), notice: "" };
    case "scanned": {
      // Completion can arrive over the live stream before the scan reply.
      const latest = event.draft.revision < state.local.revision ? state : adopt(state, event.draft);
      return { ...latest, server: newer(state.server, event.draft), warnings: event.warnings, step: 1 };
    }
    case "remoteDraft": {
      const latest = event.draft;
      if (state.operation === "opening" || state.operation === "ended") return state;
      const known = { ...state, server: newer(state.server, latest) };
      // Keep the original idempotent initiation revision if its response was lost.
      if (state.local.initializationRevision || latest.revision <= state.local.revision) return known;
      // A scan always wins: the server rejects edits while it is processing, and a
      // published bill accepts none. Otherwise preserve unrelated local edits for
      // the normal revision conflict.
      if (!clean(state) && !latest.billId && !processing(latest) && !processing(state.local)) return known;
      const adopted = adopt(known, latest);
      return processing(latest) && latest.data.mode === "items" ? { ...adopted, step: 1 } : adopted;
    }
    case "initiationStarted": {
      // A retry repeats its original revision; its reply may have been lost.
      if (event.draft.initializationRevision) return { ...adopt(state, event.draft), local: event.draft };
      const adopted = adopt(state, event.draft);
      // A newer draft saved elsewhere is shown for review rather than shared unseen.
      if (adopted.local.revision !== event.draft.revision) return adopted;
      return { ...adopted, local: { ...event.draft, initializationRevision: event.draft.revision } };
    }
    case "initiationRejected":
      // An initiated draft stays locked; only an unpublished draft returns to editing.
      return state.local.billId ? state : { ...state, local: { ...state.local, initializationRevision: undefined } };
    case "reloaded": {
      const adopted = adopt(state, event.draft);
      return { ...adopted, step: openingStep(adopted.local, event.storedStep) };
    }
    case "finished":
      return state.operation === "ended" ? state : { ...state, operation: "idle" };
    case "failed":
      return state.operation === "ended" ? state : { ...state, operation: "idle", error: event.message };
    case "ended":
      return { ...state, operation: "ended" };
  }
}

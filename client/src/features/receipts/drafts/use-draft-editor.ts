import { type Bill } from "@share-tally/domain/contracts/bills";
import { type ReceiptData, type ReceiptDraft } from "@share-tally/domain/contracts/receipts";
import { useCallback, useEffect, useRef, useState } from "react";
import { BillApiError } from "../../../shared/api/bill-error";
import { errorMessage } from "../../../shared/api/error-message";
import { groupDeletedEvent, type GroupDeleted } from "../../../shared/api/group-sync";
import { blockRouteNavigation, replaceRoute } from "../../../shared/browser/route";
import { useReceiptApi } from "../api";
import {
  type Activity, type EditorEvent, type Step,
  createEditor, hasUnsavedChanges, initiationRevision, knownToServer, leaving, opened, recoveryEntry, reduceEditor, warnBeforeUnload,
} from "./draft-model";
import { clearGroupRecovery, clearRecovery, readRecovery, readStep, recoveryKey, storeRecovery, storeStep } from "./draft-recovery";
import { useReceiptDraftSync } from "./receipt-draft-sync";

const removedMessage = "This draft no longer exists. It may have been deleted or shared elsewhere.";
const changedElsewhere = "This draft was changed elsewhere. Check it before sharing.";
const isRemoved = (error: unknown) => error instanceof BillApiError && error.status === 404;

/**
 * Owns the editor's requests, live updates, local recovery and navigation guard.
 * Every request starts through the model, so a second click cannot start a conflicting one.
 */
export function useDraftEditor({ userId, groupId, id, photoSelected, close, created }: {
  userId: string;
  groupId: string;
  id?: string;
  /** A chosen photo that has not been cropped yet is unsaved work. */
  photoSelected: boolean;
  close: () => void;
  created: (bill: Bill) => void;
}) {
  const api = useReceiptApi();
  const key = recoveryKey(userId, groupId, id);
  const [state, setState] = useState(() => {
    const recovered = readRecovery(key);
    const draftId = recovered?.id ?? id;
    return createEditor({ userId, draftId: id, recovered, storedStep: draftId ? readStep(userId, draftId) : null });
  });
  // Requests read and change the latest state synchronously, before React renders it.
  const current = useRef(state);
  const dispatch = useCallback((event: EditorEvent) => {
    const next = reduceEditor(current.current, event);
    if (next !== current.current) {
      current.current = next;
      setState(next);
    }
    return next;
  }, []);
  const latest = useRef({ close, created, photoSelected });
  useEffect(() => { latest.current = { close, created, photoSelected }; });

  const end = useCallback((step = false) => {
    dispatch({ type: "ended" });
    clearRecovery(userId, groupId, current.current.local.id, key, step);
  }, [dispatch, userId, groupId, key]);
  const removed = useCallback(() => {
    dispatch({ type: "removed", message: removedMessage });
    clearRecovery(userId, groupId, current.current.local.id, key, true);
  }, [dispatch, userId, groupId, key]);

  // Only a request for the draft itself (reload, delete) establishes its absence by a 404;
  // other requests also answer 404 for an expired photo or a missing item.
  // A new bill the server never saved is not "removed" either; its local work stays.
  const settle = useCallback(async (action: () => Promise<void>, draftRequest = false) => {
    try {
      await action();
      dispatch({ type: "finished" });
      return true;
    } catch (error) {
      if (draftRequest && isRemoved(error) && knownToServer(current.current)) removed();
      else dispatch({ type: "failed", message: errorMessage(error) });
      return false;
    }
  }, [dispatch, removed]);
  function perform(operation: Activity, action: () => Promise<void>, draftRequest = false) {
    const before = current.current;
    if (dispatch({ type: "started", operation }) === before) return Promise.resolve(false);
    return settle(action, draftRequest);
  }
  const saveLocal = useCallback(async () => {
    const { draft } = await api.save(groupId, current.current.local);
    dispatch({ type: "saved", draft });
    return draft;
  }, [api, groupId, dispatch]);

  // Runs inside an `initiating` operation.
  const initiate = useCallback(async () => {
    const { local } = current.current;
    const saved = local.initializationRevision ? local : await saveLocal();
    if (!dispatch({ type: "initiationStarted", draft: saved }).local.initializationRevision)
      throw new Error(changedElsewhere);
    try {
      const result = await api.initialize(saved.id, initiationRevision(current.current));
      end(true);
      latest.current.created(result.bill);
    } catch (error) {
      if (error instanceof BillApiError && error.status < 500) dispatch({ type: "initiationRejected" });
      throw error;
    }
  }, [api, dispatch, end, saveLocal]);

  // The model decides whether a server read must establish the saved draft first.
  const openId = state.operation === "opening" ? state.local.id : null;
  useEffect(() => {
    if (!openId) return;
    let live = true;
    api.get(openId).then(({ draft }) => {
      if (!live) return;
      const opened = dispatch({ type: "opened", draft, storedStep: readStep(userId, draft.id) });
      // A draft opened by its link that is already initiated finishes its idempotent
      // initiation; a recovered new bill instead offers its retry.
      if (id && opened.local.billId && dispatch({ type: "started", operation: "initiating" }) !== opened)
        void settle(initiate);
    }).catch((error) => {
      if (!live) return;
      if (isRemoved(error)) removed();
      else dispatch({ type: "openFailed", message: errorMessage(error) });
    });
    return () => { live = false; };
  }, [api, id, openId, userId, dispatch, removed, settle, initiate]);

  useEffect(() => {
    const entry = recoveryEntry(state);
    // Ending clears recovery synchronously; a later render must not restore it.
    if (entry && current.current.operation !== "ended") storeRecovery(key, entry);
  }, [state, key]);
  const opening = state.operation === "opening";
  useEffect(() => {
    if (!opening && current.current.operation !== "ended") storeStep(userId, state.local.id, state.step);
  }, [opening, userId, state.local.id, state.step]);

  const [syncError, setSyncError] = useState("");
  const applyRemote = useCallback((drafts: ReceiptDraft[]) => {
    if (drafts[0]) dispatch({ type: "remoteDraft", draft: drafts[0] });
  }, [dispatch]);
  useReceiptDraftSync(groupId, state.local.id, applyRemote, setSyncError,
    state.local.revision > 0 && opened(state) && state.operation !== "ended");

  // A deleted group's drafts cannot be saved or resumed; the app leaves its route.
  useEffect(() => {
    function deleted(event: Event) {
      if ((event as CustomEvent<GroupDeleted>).detail.id !== groupId) return;
      dispatch({ type: "ended" });
      clearGroupRecovery(userId, groupId);
    }
    window.addEventListener(groupDeletedEvent, deleted);
    return () => window.removeEventListener(groupDeletedEvent, deleted);
  }, [dispatch, userId, groupId]);

  // `destination` is null when leaving through the editor's own close action.
  const [leavingTo, setLeavingTo] = useState<{ destination: string | null } | null>(null);
  useEffect(() => {
    const unblock = blockRouteNavigation((destination) => {
      switch (leaving(current.current, latest.current.photoSelected)) {
        case "stay": return true;
        case "keep-recovery": return false; // Preserve recovery until the server read completes.
        case "leave":
          if (current.current.operation !== "ended") end();
          return false;
        case "ask":
          setLeavingTo({ destination });
          return true;
      }
    });
    const warn = (event: BeforeUnloadEvent) => {
      if (!warnBeforeUnload(current.current, latest.current.photoSelected)) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => { unblock(); window.removeEventListener("beforeunload", warn); };
  }, [end]);

  const scan = () => perform("scanning", async () => {
    // Save both the draft and photo first: the saved scan owns the extraction result.
    const saved = await saveLocal();
    const { draft, extraction } = await api.extract(saved.id, saved.revision);
    dispatch({ type: "scanned", draft, warnings: extraction.warnings });
  });

  return {
    state,
    syncError,
    leavingTo,
    edit: (patch: Partial<ReceiptData>) => dispatch({ type: "edited", patch }),
    chooseStep: (step: Step) => dispatch({ type: "stepChosen", step }),
    scan,
    cropPhoto(base64: string) {
      if (dispatch({ type: "photoCropped", base64 }).local.pendingPhoto !== base64) return Promise.resolve(false);
      return scan();
    },
    confirmItem: (itemId: string, flag: "needsCheck" | "taxNotChecked") =>
      perform("confirming", async () => {
        const unsaved = hasUnsavedChanges(current.current, latest.current.photoSelected);
        const saved = unsaved ? await saveLocal() : current.current.local;
        if (saved.data.items.find((item) => item.id === itemId)?.[flag] === false) return;
        const { draft } = await api.confirmItem(saved.id, itemId, saved.revision, flag);
        dispatch({ type: "saved", draft });
      }),
    saveAndClose: () => perform("saving", async () => {
      await saveLocal();
      end();
      latest.current.close();
    }),
    share: () => perform("initiating", initiate),
    reload: () => perform("reloading", async () => {
      const { draft } = await api.get(current.current.local.id);
      dispatch({ type: "reloaded", draft, storedStep: readStep(userId, draft.id) });
    }, true),
    remove: () => perform("deleting", async () => {
      const { local } = current.current;
      await api.remove(local.id, local.revision);
      end(true);
      latest.current.close();
    }, true),
    requestClose() {
      switch (leaving(current.current, latest.current.photoSelected)) {
        case "stay": return;
        case "ask": setLeavingTo({ destination: null }); return;
        case "leave": if (current.current.operation !== "ended") end(); break;
        case "keep-recovery": break; // The server read has not yet established whether recovery differs.
      }
      latest.current.close();
    },
    /** Repeats the server read after opening failed, checking recovery again. */
    retryOpen: () => dispatch({ type: "reopened" }),
    keepEditing: () => setLeavingTo(null),
    discard() {
      const destination = leavingTo?.destination;
      end();
      if (destination) replaceRoute(destination);
      else latest.current.close();
    },
  };
}

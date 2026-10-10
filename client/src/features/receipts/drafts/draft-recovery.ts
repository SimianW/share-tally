import { type ReceiptDraft } from "@share-tally/domain/contracts/receipts";
import { recoverReceiptData } from "../pricing/receipt-pricing";

// Unsaved editor work for one identity, group and bill draft, kept for this tab only.
// Storage can be unavailable or full (large photos); editing then continues in memory
// and nothing here reports a stored copy that does not exist.

function storage(): Storage | null {
  try { return window.sessionStorage; } catch { return null; }
}
function read(key: string) {
  try { return storage()?.getItem(key) ?? null; } catch { return null; }
}
function remove(key: string) {
  try { storage()?.removeItem(key); } catch { /* Nothing is stored. */ }
}
function storedId(key: string): string | undefined {
  try { return JSON.parse(read(key) ?? "null")?.id; } catch { return undefined; }
}

function storedKeys(): string[] {
  try { return Object.keys(storage() ?? {}); } catch { return []; }
}

export const recoveryKey = (userId: string, groupId: string, draftId?: string) =>
  `receipt-draft:${userId}:${groupId}:${draftId ?? "new"}`;
const stepKey = (userId: string, draftId: string) => `receipt-step:${userId}:${draftId}`;

export function readRecovery(key: string): ReceiptDraft | null {
  try {
    const recovered = JSON.parse(read(key) ?? "null") as ReceiptDraft | null;
    return recovered && { ...recovered, data: recoverReceiptData(recovered.data) };
  } catch {
    return null; // The saved server draft remains available.
  }
}

/** Returns whether the copy was stored; a failed write removes any older copy. */
export function storeRecovery(key: string, draft: ReceiptDraft) {
  try {
    const target = storage();
    if (!target) return false;
    target.setItem(key, JSON.stringify(draft));
    return true;
  } catch {
    remove(key);
    return false;
  }
}

export const readStep = (userId: string, draftId: string) => read(stepKey(userId, draftId));
export function storeStep(userId: string, draftId: string, step: number) {
  try { storage()?.setItem(stepKey(userId, draftId), String(step)); } catch { /* The opening step is derived instead. */ }
}

/** Clears this editor's copy, including a new-bill copy that has since been saved under its ID. */
export function clearRecovery(userId: string, groupId: string, draftId: string, key: string, step = false) {
  remove(key);
  const newKey = recoveryKey(userId, groupId);
  if (storedId(newKey) === draftId) remove(newKey);
  if (step) remove(stepKey(userId, draftId));
}

/** Lost group access ends recovery, even if the editor is not currently mounted. */
export function clearGroupRecovery(userId: string, groupId: string) {
  const prefix = `receipt-draft:${userId}:${groupId}:`;
  const keys = storedKeys();
  for (const key of keys.filter((entry) => entry.startsWith(prefix))) {
    const id = storedId(key);
    if (id) remove(stepKey(userId, id));
    remove(key);
  }
}

export function clearDeletedDraft(id: string) {
  const keys = storedKeys();
  for (const key of keys) {
    if (key.startsWith("receipt-step:") && key.endsWith(`:${id}`)) remove(key);
    if (key.startsWith("receipt-draft:") && storedId(key) === id) remove(key);
  }
}

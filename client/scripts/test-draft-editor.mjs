import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canOpenStep, createEditor, editable, hasUnsavedChanges, initiationRevision, knownToServer, leaving,
  recoveryEntry, reduceEditor, shareable, stepAvailable, stepOpen,
} from "../src/features/receipts/drafts/draft-model.ts";

const userId = "user-1";
const item = (patch = {}) => ({
  id: "item-1", name: "Apples", originalText: "", quantity: "1", amountCents: 500,
  discountCents: 0, taxable: false, finalCents: 500, manualFinal: false, ...patch,
});
const saved = (revision, data = {}, patch = {}) => ({
  id: "draft-1", revision, processingStatus: "ready", processingStartedAt: null,
  data: {
    mode: "items", title: "Groceries", purchaseDate: "2026-09-24", timeZone: "America/Toronto",
    notes: "", totalCents: null, participantIds: [userId], items: [item()],
    receipt: { subtotalCents: 500, taxCents: 0, discountCents: 0, extraCents: 0, pricesIncludeTax: false },
    ...data,
  },
  ...patch,
});
const run = (state, ...events) => events.reduce(reduceEditor, state);
const open = (draft, recovered = null) => run(
  createEditor({ userId, draftId: draft.id, recovered, storedStep: null }),
  { type: "opened", draft, storedStep: null },
);

test("a failed save keeps the local edit, and reopening recovers it against the same saved revision", () => {
  const server = saved(3);
  const failed = run(open(server),
    { type: "edited", patch: { title: "Costco run" } },
    { type: "started", operation: "saving" },
    { type: "failed", message: "Network down" });
  assert.equal(failed.operation, "idle");
  assert.equal(failed.error, "Network down");
  assert.equal(failed.local.data.title, "Costco run");
  assert.equal(hasUnsavedChanges(failed), true);

  const reopened = open(server, recoveryEntry(failed));
  assert.equal(reopened.local.data.title, "Costco run");
  assert.equal(reopened.local.revision, 3);
  assert.equal(reopened.notice, "Recovered your unsaved changes.");
  assert.equal(hasUnsavedChanges(reopened), true);
});

test("a recovery entry from an older saved revision is discarded for the newer saved draft", () => {
  const edited = run(open(saved(3)), { type: "edited", patch: { title: "Old local title" } });
  const reopened = open(saved(4, { title: "Saved elsewhere" }), recoveryEntry(edited));
  assert.equal(reopened.local.data.title, "Saved elsewhere");
  assert.equal(reopened.local.revision, 4);
  assert.equal(reopened.notice, "");
  assert.equal(hasUnsavedChanges(reopened), false);
});

test("a scan result arriving over the live stream before the scan reply is kept", () => {
  const blank = saved(3, { items: [], receipt: undefined });
  const withPhoto = saved(4, { items: [] }, { photo: { expiresAt: "2026-10-01", expired: false } });
  const scanning = saved(5, { items: [] }, { processingStatus: "processing", photo: withPhoto.photo });
  const scanned = saved(6, { items: [item({ name: "Friendly item 1" })] }, { photo: withPhoto.photo });
  const state = run(open(blank),
    { type: "photoCropped", base64: "cGhvdG8=" },
    { type: "started", operation: "scanning" },
    { type: "saved", draft: withPhoto },
    { type: "remoteDraft", draft: scanning },
    { type: "remoteDraft", draft: scanned },
    { type: "scanned", draft: scanning, warnings: ["Check the total"] },
    { type: "finished" });
  assert.equal(state.local.revision, 6);
  assert.equal(state.local.processingStatus, "ready");
  assert.deepEqual(state.local.data.items.map((i) => i.name), ["Friendly item 1"]);
  assert.deepEqual(state.warnings, ["Check the total"]);
  assert.equal(state.step, 1);
  assert.equal(hasUnsavedChanges(state), false);
});

test("a live update does not overwrite unrelated local edits on a ready draft", () => {
  const state = run(open(saved(3)),
    { type: "edited", patch: { title: "Local title" } },
    { type: "remoteDraft", draft: saved(4, { title: "Remote title" }) });
  assert.equal(state.local.data.title, "Local title");
  assert.equal(state.local.revision, 3, "saving still checks the saved revision for a conflict");
  assert.equal(state.server.revision, 4);
});

test("a repeated initiation reuses the original initiation revision after its reply was lost", () => {
  const ready = saved(3, { mode: "manual", items: [], totalCents: 1200 });
  let state = run(open(ready), { type: "stepChosen", step: 2 });
  assert.equal(shareable(state), true);
  state = run(state,
    { type: "started", operation: "initiating" },
    { type: "initiationStarted", draft: ready },
    { type: "failed", message: "Network error" },
    { type: "remoteDraft", draft: saved(4, { mode: "manual", items: [], totalCents: 1200 }) });
  assert.equal(state.local.initializationRevision, 3);
  assert.equal(editable(state), false);
  assert.equal(hasUnsavedChanges(state), false);
  state = run(state, { type: "started", operation: "initiating" });
  assert.equal(state.operation, "initiating");
  assert.equal(initiationRevision(state), 3);
  // Reopening after a reload retries the same revision.
  const reopened = open(ready, recoveryEntry(state));
  assert.equal(reopened.step, 2);
  assert.equal(initiationRevision(reopened), 3);
});

test("a rejected initiation unlocks the draft for editing", () => {
  const ready = saved(3, { mode: "manual", items: [], totalCents: 1200 });
  const state = run(open(ready), { type: "stepChosen", step: 2 },
    { type: "started", operation: "initiating" },
    { type: "initiationStarted", draft: ready },
    { type: "initiationRejected" },
    { type: "failed", message: "Choose who is sharing" });
  assert.equal(state.local.initializationRevision, undefined);
  assert.equal(editable(state), true);
});

test("an initiated bill draft never reopens as an editable local draft", () => {
  const initiated = saved(5, { title: "Shared already" }, { billId: "bill-1" });
  const edited = run(open(saved(5, { title: "Shared already" })), { type: "edited", patch: { title: "Stale local" } });
  const reopened = open(initiated, recoveryEntry(edited));
  assert.equal(editable(reopened), false);
  assert.equal(reopened.step, 2);
  assert.equal(reopened.local.data.title, "Shared already");
  assert.equal(initiationRevision(reopened), 5);
  assert.equal(editable(run(reopened, { type: "failed", message: "Try again" })), false);
  assert.equal(editable(run(reopened, { type: "initiationRejected" }, { type: "failed", message: "Try again" })), false);
});

test("a processing draft stays viewable but blocks edits and initiation", () => {
  const scanning = saved(4, {}, { processingStatus: "processing" });
  const state = open(scanning);
  assert.equal(state.step, 1);
  assert.equal(editable(state), false);
  const after = run(state,
    { type: "edited", patch: { title: "Blocked" } },
    { type: "stepChosen", step: 2 },
    { type: "started", operation: "initiating" },
    { type: "started", operation: "saving" });
  assert.equal(after.local.data.title, "Groceries");
  assert.equal(after.step, 1);
  assert.equal(after.operation, "idle");
  assert.equal(stepAvailable(after, 0), false);
  // Its result replaces the locked content without field-level merging.
  const done = run(after, { type: "remoteDraft", draft: saved(5, { title: "Scanned" }) });
  assert.equal(done.local.data.title, "Scanned");
  assert.equal(editable(done), true);
});

test("only one activity runs at a time", () => {
  const state = run(open(saved(3)),
    { type: "started", operation: "saving" },
    { type: "started", operation: "scanning" },
    { type: "started", operation: "deleting" });
  assert.equal(state.operation, "saving");
  assert.equal(leaving(state), "stay");
  assert.equal(run(state, { type: "edited", patch: { title: "During save" } }).local.data.title, "Groceries");
});

test("leaving keeps recovery while opening, asks only about unsaved changes, and never holds an ended editor", () => {
  const opening = createEditor({ userId, draftId: "draft-1", recovered: saved(3, { title: "Local" }), storedStep: null });
  assert.equal(leaving(opening), "keep-recovery");
  assert.equal(recoveryEntry(opening), null);
  const opened = open(saved(3));
  assert.equal(leaving(opened), "leave");
  assert.equal(leaving(opened, true), "ask", "a chosen, uncropped photo is unsaved");
  const dirty = run(opened, { type: "edited", patch: { title: "Changed" } });
  assert.equal(leaving(dirty), "ask");
  const removed = run(dirty, { type: "removed", message: "This draft was deleted." });
  assert.equal(leaving(removed), "leave");
  assert.equal(recoveryEntry(removed), null);
});

test("explicit manual entry opens an empty Items step, and returning to Receipt restores its prerequisite", () => {
  let state = createEditor({ userId, recovered: null, storedStep: null });
  assert.equal(state.step, 0);
  assert.equal(stepOpen(state, 1), false);
  state = run(state, { type: "edited", patch: { mode: "items" } }, { type: "stepChosen", step: 1 });
  assert.equal(state.step, 1);
  assert.equal(stepOpen(state, 2), false);
  state = run(state, { type: "stepChosen", step: 0 });
  assert.equal(stepOpen(state, 1), false);
});

test("manual mode opens People and skips Items", () => {
  const state = run(createEditor({ userId, recovered: null, storedStep: null }),
    { type: "edited", patch: { mode: "manual" } });
  assert.equal(stepOpen(state, 2), true);
  assert.equal(stepOpen(run(state, { type: "stepChosen", step: 2 }), 1), false);
});

test("item readiness needs complete items and assigned receipt tax, but not review hints", () => {
  const data = (items, taxCents = 0) => saved(1, { items, receipt: {
    subtotalCents: 500, taxCents, discountCents: 0, extraCents: 0, pricesIncludeTax: false,
  } }).data;
  assert.equal(canOpenStep(data([item({ amountCents: null, finalCents: null })]), 2), false);
  assert.equal(canOpenStep(data([item({ name: " " })]), 2), false);
  assert.equal(canOpenStep(data([item()], 65), 2), false, "receipt tax needs a taxable item");
  assert.equal(canOpenStep(data([item({ taxable: true, finalCents: 565 })], 65), 2), true);
  assert.equal(canOpenStep(data([item({ needsCheck: true, taxNotChecked: true })]), 2), true);
});

test("a save or reload reply older than a live update does not replace the newer saved draft", () => {
  const saving = run(open(saved(3)),
    { type: "edited", patch: { title: "Saved here" } },
    { type: "started", operation: "saving" },
    { type: "remoteDraft", draft: saved(5, { title: "Saved in another tab" }) });
  const replied = run(saving, { type: "saved", draft: saved(4, { title: "Saved here" }) }, { type: "finished" });
  assert.equal(replied.local.revision, 5);
  assert.equal(replied.local.data.title, "Saved in another tab");
  assert.equal(hasUnsavedChanges(replied), false);
  const reloaded = run(open(saved(3)),
    { type: "started", operation: "reloading" },
    { type: "remoteDraft", draft: saved(5, { title: "Newer" }) },
    { type: "reloaded", draft: saved(4, { title: "Older" }), storedStep: null });
  assert.equal(reloaded.local.data.title, "Newer");
});

test("an initiated draft arriving by reload or live update stays locked for its idempotent retry", () => {
  const initiated = saved(6, {}, { billId: "bill-1" });
  const reloaded = run(open(saved(5)),
    { type: "started", operation: "reloading" },
    { type: "reloaded", draft: initiated, storedStep: "1" },
    { type: "finished" });
  assert.equal(editable(reloaded), false);
  assert.equal(reloaded.step, 2);
  assert.equal(initiationRevision(reloaded), 6);
  const live = run(open(saved(5)), { type: "remoteDraft", draft: initiated });
  assert.equal(editable(live), false);
  assert.equal(initiationRevision(live), 6);
  // Unsaved edits cannot be saved to a published bill, so they do not keep it editable.
  const dirty = run(open(saved(5)), { type: "edited", patch: { title: "Unsaved here" } },
    { type: "remoteDraft", draft: initiated });
  assert.equal(editable(dirty), false);
  assert.equal(dirty.step, 2);
  assert.equal(initiationRevision(dirty), 6);
  assert.equal(hasUnsavedChanges(dirty), false);
});

test("a new-bill recovery copy already saved by a scan is checked against the server before it opens", () => {
  const local = run(open(saved(3)), { type: "edited", patch: { title: "Local after scan" } });
  const reopened = createEditor({ userId, recovered: recoveryEntry(local), storedStep: null });
  assert.equal(reopened.operation, "opening");
  assert.equal(leaving(reopened), "keep-recovery");
  const opened = run(reopened, { type: "opened", draft: saved(4, { title: "Saved elsewhere" }), storedStep: null });
  assert.equal(opened.local.data.title, "Saved elsewhere");
  // An unsaved new bill still opens at once.
  const unsaved = run(createEditor({ userId, recovered: null, storedStep: null }), { type: "edited", patch: { title: "Unsaved" } });
  assert.equal(createEditor({ userId, recovered: recoveryEntry(unsaved), storedStep: null }).operation, "idle");
});

test("initiation stops for review when a newer saved draft arrived during its save", () => {
  const ready = (revision, title) => saved(revision, { mode: "manual", items: [], totalCents: 1200, title });
  const state = run(open(ready(3, "Local")), { type: "stepChosen", step: 2 },
    { type: "edited", patch: { title: "Edited here" } },
    { type: "started", operation: "initiating" },
    { type: "remoteDraft", draft: ready(5, "Saved in another tab") },
    { type: "saved", draft: ready(4, "Edited here") },
    { type: "initiationStarted", draft: ready(4, "Edited here") });
  assert.equal(state.local.initializationRevision, undefined, "the newer draft is not shared unreviewed");
  assert.equal(state.local.revision, 5);
  assert.equal(state.local.data.title, "Saved in another tab");
  assert.equal(hasUnsavedChanges(state), false);
  // A retry keeps its original revision even if a newer draft was seen.
  const retry = run(open(ready(3, "Local")), { type: "stepChosen", step: 2 },
    { type: "started", operation: "initiating" },
    { type: "initiationStarted", draft: ready(3, "Local") },
    { type: "failed", message: "Network error" },
    { type: "remoteDraft", draft: ready(4, "Shared") },
    { type: "started", operation: "initiating" },
    { type: "initiationStarted", draft: { ...ready(3, "Local"), initializationRevision: 3 } });
  assert.equal(initiationRevision(retry), 3);
});

test("a draft whose server read failed stays unopened, keeps its recovery and can retry opening", () => {
  const recovered = run(open(saved(3)), { type: "edited", patch: { title: "Local edit" } });
  const failed = run(createEditor({ userId, draftId: "draft-1", recovered: recoveryEntry(recovered), storedStep: null }),
    { type: "openFailed", message: "Network down" },
    { type: "edited", patch: { title: "Typed into an unopened draft" } },
    { type: "started", operation: "saving" });
  assert.equal(failed.error, "Network down");
  assert.equal(failed.operation, "idle");
  assert.equal(editable(failed), false);
  assert.equal(failed.local.data.title, "Local edit");
  assert.equal(hasUnsavedChanges(failed), false);
  assert.equal(leaving(failed), "keep-recovery");
  assert.equal(recoveryEntry(failed), null, "the browser copy is left as it was");
  const retried = run(failed, { type: "reopened" });
  assert.equal(retried.operation, "opening");
  assert.equal(retried.error, "");
  const opened = run(retried, { type: "opened", draft: saved(3), storedStep: null });
  assert.equal(opened.local.data.title, "Local edit");
  assert.equal(opened.notice, "Recovered your unsaved changes.");
});

test("only a draft the server has known can be removed", () => {
  const unsaved = run(createEditor({ userId, recovered: null, storedStep: null }), { type: "edited", patch: { title: "Never saved" } });
  assert.equal(knownToServer(unsaved), false);
  assert.equal(knownToServer(open(saved(3))), true);
});

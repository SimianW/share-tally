import { db } from "./db/index.js";
import { processReceipt } from "./receipt-processing.js";
import { interpretReceiptNames } from "./receipt-names.js";
import { priceDraft } from "./receipt-pricing.js";
import { Router } from "express";
import { z } from "zod";
import { getGroupUser } from "./users.js";
import { BillError, isUuid, readBills } from "./bills.js";
import { checked, revisionInput, draftInput } from "./receipt-input.js";
import {
  saveDraft,
  editable,
  saveProcessingDraft,
  deleteDraft,
  normalizeReceiptPhoto,
  requireMember,
  readDraft,
  listDrafts,
  uploadPhoto,
  photoBytes,
  initializeDraft,
} from "./receipt-drafts.js";
import { startReceiptModel } from "./receipt-reading.js";
import { type ReceiptExtractor } from "./receipt-extraction.js";
import { azureExtract } from "./azure-receipt.js";
import { confirmClaims, editItems, correctItem } from "./item-bills.js";
export function createReceiptRouter(
  displayName: (id: string) => Promise<string>,
  extract: ReceiptExtractor = azureExtract,
  names: typeof interpretReceiptNames = interpretReceiptNames,
) {
  const router = Router();
  const active = new Set<string>();
  const daily = new Map<string, { day: string; count: number }>();
  function consumeRequest(userId: string) {
    const day = new Date().toISOString().slice(0, 10);
    for (const [id, entry] of daily) if (entry.day !== day) daily.delete(id);
    const usage = daily.get(userId) ?? { day, count: 0 };
    const configured = Number(process.env.RECEIPT_DAILY_LIMIT || 50);
    const limit =
      Number.isSafeInteger(configured) && configured > 0 ? configured : 50;
    if (usage.count >= limit)
      throw new BillError(
        429,
        "Daily receipt scan limit reached. You can still enter items manually.",
      );
    usage.count++;
    daily.set(userId, usage);
  }
  const user = (id: string) => getGroupUser(id, displayName);
  for (const key of ["groupId", "draftId", "billId"])
    router.param(key, (_req, _res, next, id) =>
      next(isUuid(id) ? undefined : new BillError(404, "Record not found.")),
    );
  router.delete("/receipt-drafts/:draftId", async (req, res) => {
    const u = await user(res.locals.clerkUserId);
    await deleteDraft(req.params.draftId, u.id, req.body);
    res.json({ deleted: true });
  });
  // Unsaved previews do not persist; the legacy saved-preview route uses the
  // same two-stage lifecycle as the saved draft scan endpoint.
  router.post(
    "/groups/:groupId/receipt-preview/:operation",
    async (req, res) => {
      const u = await user(res.locals.clerkUserId);
      await db.transaction((tx) => requireMember(tx, req.params.groupId, u.id));
      const operation = req.params.operation;
      if (operation === "prices") {
        res.json(priceDraft(checked(draftInput, req.body)));
        return;
      }
      if (operation !== "extract")
        throw new BillError(404, "Preview not found.");
      if (active.has(u.id))
        throw new BillError(429, "A receipt request is already running.");
      consumeRequest(u.id);
      active.add(u.id);
      try {
        const input = checked(
          z.union([
            z.object({ base64: z.string().max(11_184_812) }).strict(),
            z.object({ draftId: z.uuid(), revision: revisionInput }).strict(),
          ]),
          req.body,
        );
        let bytes: Buffer;
        if ("base64" in input)
          bytes = await normalizeReceiptPhoto(input.base64);
        else {
          const draft = await readDraft(input.draftId, u.id);
          if (draft.groupId !== req.params.groupId)
            throw new BillError(404, "Draft not found.");
          editable(draft, input.revision);
          bytes = await photoBytes(input.draftId, u.id, true);
        }
        const scanned = await extract(bytes);
        const mappingStart = performance.now();
        const extraction = processReceipt(scanned);
        if (scanned.scanTimings) scanned.scanTimings.mappingMs += performance.now() - mappingStart;
        if ("draftId" in input) {
          const draft = await saveProcessingDraft(input.draftId, u.id, input.revision, extraction, scanned.rawAnalysis);
          startReceiptModel(draft, scanned, names);
          res.json({ draft, extraction });
        } else {
          // Unsaved previews map Azure only; saved scans own background work.
          res.json({ extraction });
        }
      } finally {
        active.delete(u.id);
      }
    },
  );
  router.get("/groups/:groupId/receipt-drafts", async (req, res) => {
    const u = await user(res.locals.clerkUserId);
    res.json({ drafts: await listDrafts(req.params.groupId, u.id) });
  });
  router.put("/groups/:groupId/receipt-drafts/:draftId", async (req, res) => {
    const u = await user(res.locals.clerkUserId);
    res.json({
      draft: await saveDraft(
        req.params.groupId,
        u.id,
        req.params.draftId,
        req.body,
      ),
    });
  });
  router.get("/receipt-drafts/:draftId", async (req, res) => {
    const u = await user(res.locals.clerkUserId);
    res.json({ draft: await readDraft(req.params.draftId, u.id) });
  });
  router.put("/receipt-drafts/:draftId/photo", async (req, res) => {
    const u = await user(res.locals.clerkUserId);
    await uploadPhoto(req.params.draftId, u.id, req.body);
    res.json({ draft: await readDraft(req.params.draftId, u.id) });
  });
  router.get("/receipt-drafts/:draftId/photo", async (req, res) => {
    const u = await user(res.locals.clerkUserId);
    res
      .type("image/jpeg")
      .set("X-Content-Type-Options", "nosniff")
      .send(await photoBytes(req.params.draftId, u.id));
  });
  router.post("/receipt-drafts/:draftId/extract", async (req, res) => {
    const u = await user(res.locals.clerkUserId);
    const { revision } = checked(
      z.object({ revision: revisionInput }).strict(),
      req.body,
    );
    const draft = await readDraft(req.params.draftId, u.id);
    editable(draft, revision);
    if (active.has(u.id))
      throw new BillError(
        429,
        "Your receipt is already being read. Please wait.",
      );
    consumeRequest(u.id);
    active.add(u.id);
    try {
      const scanned = await extract(await photoBytes(req.params.draftId, u.id, true));
      const mappingStart = performance.now();
      const extraction = processReceipt(scanned);
      if (scanned.scanTimings) scanned.scanTimings.mappingMs += performance.now() - mappingStart;
      const processing = await saveProcessingDraft(req.params.draftId, u.id, revision, extraction, scanned.rawAnalysis);
      startReceiptModel(processing, scanned, names);
      res.json({ draft: processing, extraction });
    } finally {
      active.delete(u.id);
    }
  });
  router.post("/receipt-drafts/:draftId/prices", async (req, res) => {
    const u = await user(res.locals.clerkUserId);
    const { revision } = checked(
      z.object({ revision: revisionInput }).strict(),
      req.body,
    );
    const draft = await readDraft(req.params.draftId, u.id);
    editable(draft, revision);
    res.json(priceDraft(draft.data));
  });
  router.post("/receipt-drafts/:draftId/initialize", async (req, res) => {
    const u = await user(res.locals.clerkUserId);
    const id = await initializeDraft(req.params.draftId, u.id, req.body);
    res.json({ bill: (await readBills(u.id, undefined, id))[0] });
  });
  router.post("/bills/:billId/claims", async (req, res) => {
    const u = await user(res.locals.clerkUserId);
    await confirmClaims(req.params.billId, u.id, req.body);
    res.json({
      bill: (await readBills(u.id, undefined, req.params.billId))[0],
    });
  });
  router.patch("/bills/:billId/items/:itemId", async (req, res) => {
    const u = await user(res.locals.clerkUserId);
    await correctItem(req.params.billId, req.params.itemId, u.id, req.body);
    res.json({ bill: (await readBills(u.id, undefined, req.params.billId))[0] });
  });
  router.put("/bills/:billId/items", async (req, res) => {
    const u = await user(res.locals.clerkUserId);
    await editItems(req.params.billId, u.id, req.body);
    res.json({
      bill: (await readBills(u.id, undefined, req.params.billId))[0],
    });
  });
  return router;
}

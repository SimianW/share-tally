import { interpretReceiptNames } from "./receipt-names.js";
import { priceDraft } from "./receipt-pricing.js";
import { Router } from "express";
import { z } from "zod";
import { getGroupUser } from "./users.js";
import { BillError, isUuid, readBills } from "./bills.js";
import { checked, revisionInput } from "./receipt-input.js";
import {
  saveDraft,
  readDraft,
  listDrafts,
  uploadPhoto,
  photoBytes,
  initializeDraft,
} from "./receipt-drafts.js";
import {
  extractionDefaults,
  type ReceiptExtractor,
} from "./receipt-extraction.js";
import { azureExtract } from "./azure-receipt.js";
import { confirmClaims, editItems } from "./item-bills.js";
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
    if (draft.billId || draft.revision !== revision)
      throw new BillError(409, "Draft changed. Reopen it before scanning.");
    if (active.has(u.id))
      throw new BillError(
        429,
        "Your receipt is already being read. Please wait.",
      );
    consumeRequest(u.id);
    active.add(u.id);
    try {
      const data = extractionDefaults(
        await extract(await photoBytes(req.params.draftId, u.id, true)),
      );
      const latest = await readDraft(req.params.draftId, u.id);
      if (latest.revision !== revision || latest.billId)
        throw new BillError(
          409,
          "Draft changed during scanning. Saved edits were kept. Scan again from the current draft.",
        );
      res.json({ extraction: data });
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
    if (draft.billId || draft.revision !== revision)
      throw new BillError(409, "Draft changed. Reopen the saved version.");
    res.json(priceDraft(draft.data));
  });
  router.post("/receipt-drafts/:draftId/names", async (req, res) => {
    const u = await user(res.locals.clerkUserId);
    const { revision } = checked(
      z.object({ revision: revisionInput }).strict(),
      req.body,
    );
    const draft = await readDraft(req.params.draftId, u.id);
    if (draft.billId || draft.revision !== revision)
      throw new BillError(409, "Draft changed. Reopen the saved version.");
    if (active.has(u.id))
      throw new BillError(429, "A receipt request is already running.");
    consumeRequest(u.id);
    active.add(u.id);
    try {
      const result = await names(draft.data.items);
      const latest = await readDraft(req.params.draftId, u.id);
      if (latest.billId || latest.revision !== revision)
        throw new BillError(
          409,
          "Draft changed during naming. Your edits were kept.",
        );
      res.json({ names: result });
    } catch (error) {
      if (error instanceof BillError) throw error;
      throw new BillError(
        502,
        "Name service unavailable. Original descriptions and amounts were kept. Retry names, edit them yourself, or initiate now.",
      );
    } finally {
      active.delete(u.id);
    }
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
  router.put("/bills/:billId/items", async (req, res) => {
    const u = await user(res.locals.clerkUserId);
    await editItems(req.params.billId, u.id, req.body);
    res.json({
      bill: (await readBills(u.id, undefined, req.params.billId))[0],
    });
  });
  return router;
}

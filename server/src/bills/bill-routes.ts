import type { AvatarReader } from "../identity/avatars.js";
import { Router } from "express";
import { getGroupUser } from "../identity/users.js";
import { BillError } from "../shared/bill-error.js";
import { changeBill, createBill, submitShare } from "./bills.js";
import { readBills, readGroupBills, readSummary } from "./queries.js";
import { isUuid } from "../shared/input-validation.js";
import { parseAction, parseEdit, parseBill, parseShare } from "./inputs.js";
import type { ProfileReader } from '../identity/clerk-profiles.js';

export function createBillsRouter(
  profiles: ProfileReader,
  avatars: AvatarReader,
) {
  const router = Router();
  const readWithAvatars = async (...args: Parameters<typeof readBills>) => {
    return withAvatars(await readBills(...args));
  };
  const withAvatars = async (bills: Awaited<ReturnType<typeof readBills>>) => {
    const images = await avatars(bills.flatMap(bill => bill.participants.map(p => p.userId)));
    return bills.map(bill => ({ ...bill, participants: bill.participants.map(p => ({
      ...p, ...images.get(p.userId),
    })) }));
  };
  const currentUser = (id: string) => getGroupUser(id, profiles);
  for (const param of ["groupId", "billId"])
    router.param(param, (_req, _res, next, id) => {
      next(isUuid(id) ? undefined : new BillError(404, "Record not found."));
    });
  router.get("/summary", async (_req, res) => {
    const user = await currentUser(res.locals.clerkUserId);
    res.json({ summary: await readSummary(user.id) });
  });
  router.get("/groups/:groupId/bills", async (req, res) => {
    const user = await currentUser(res.locals.clerkUserId);
    const result = await readGroupBills(user.id, req.params.groupId);
    res.json({ ...result, bills: await withAvatars(result.bills) });
  });
  router.post("/groups/:groupId/bills", async (req, res) => {
    const input = parseBill(req.body);
    const user = await currentUser(res.locals.clerkUserId);
    const id = await createBill(req.params.groupId, user.id, input);
    res
      .status(201)
      .json({ bill: (await readWithAvatars(user.id, undefined, id))[0] });
  });
  router.get("/bills/:billId", async (req, res) => {
    const user = await currentUser(res.locals.clerkUserId);
    res.json({
      bill: (await readWithAvatars(user.id, undefined, req.params.billId))[0],
    });
  });
  router.post("/bills/:billId/share", async (req, res) => {
    const amount = parseShare(req.body);
    const user = await currentUser(res.locals.clerkUserId);
    await submitShare(req.params.billId, user.id, amount);
    res.json({
      bill: (await readWithAvatars(user.id, undefined, req.params.billId))[0],
    });
  });
  router.patch("/bills/:billId", async (req, res) => {
    const input = parseEdit(req.body);
    const user = await currentUser(res.locals.clerkUserId);
    await changeBill(req.params.billId, user.id, { action: "edit", input });
    res.json({
      bill: (await readWithAvatars(user.id, undefined, req.params.billId))[0],
    });
  });
  router.post("/bills/:billId/cancel", async (req, res) => {
    const revision = parseAction(req.body);
    const user = await currentUser(res.locals.clerkUserId);
    await changeBill(req.params.billId, user.id, {
      action: "cancel",
      revision,
    });
    res.json({
      bill: (await readWithAvatars(user.id, undefined, req.params.billId))[0],
    });
  });
  return router;
}

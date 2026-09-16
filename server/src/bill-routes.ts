import { Router } from "express";
import { getGroupUser } from "./users.js";
import {
  BillError,
  changeBill,
  parseAction,
  parseEdit,
  createBill,
  isUuid,
  parseBill,
  parseShare,
  readBills,
  submitShare,
  summarize,
} from "./bills.js";

export function createBillsRouter(
  displayName: (id: string) => Promise<string>,
) {
  const router = Router();
  const currentUser = (id: string) => getGroupUser(id, displayName);
  for (const param of ["groupId", "billId"])
    router.param(param, (_req, _res, next, id) => {
      next(isUuid(id) ? undefined : new BillError(404, "Record not found."));
    });
  router.get("/summary", async (_req, res) => {
    const user = await currentUser(res.locals.clerkUserId);
    res.json({ summary: summarize(await readBills(user.id), user.id) });
  });
  router.get("/groups/:groupId/bills", async (req, res) => {
    const user = await currentUser(res.locals.clerkUserId);
    const bills = await readBills(user.id, req.params.groupId);
    res.json({ bills, summary: summarize(bills, user.id) });
  });
  router.post("/groups/:groupId/bills", async (req, res) => {
    const input = parseBill(req.body);
    const user = await currentUser(res.locals.clerkUserId);
    const id = await createBill(req.params.groupId, user.id, input);
    res
      .status(201)
      .json({ bill: (await readBills(user.id, undefined, id))[0] });
  });
  router.get("/bills/:billId", async (req, res) => {
    const user = await currentUser(res.locals.clerkUserId);
    res.json({
      bill: (await readBills(user.id, undefined, req.params.billId))[0],
    });
  });
  router.post("/bills/:billId/share", async (req, res) => {
    const amount = parseShare(req.body);
    const user = await currentUser(res.locals.clerkUserId);
    await submitShare(req.params.billId, user.id, amount);
    res.json({
      bill: (await readBills(user.id, undefined, req.params.billId))[0],
    });
  });
  router.patch("/bills/:billId", async (req, res) => {
    const input = parseEdit(req.body);
    const user = await currentUser(res.locals.clerkUserId);
    await changeBill(req.params.billId, user.id, "edit", input.revision, input);
    res.json({
      bill: (await readBills(user.id, undefined, req.params.billId))[0],
    });
  });
  for (const action of ["reopen", "cancel"] as const)
    router.post(`/bills/:billId/${action}`, async (req, res) => {
      const revision = parseAction(req.body);
      const user = await currentUser(res.locals.clerkUserId);
      await changeBill(req.params.billId, user.id, action, revision);
      res.json({
        bill: (await readBills(user.id, undefined, req.params.billId))[0],
      });
    });
  return router;
}

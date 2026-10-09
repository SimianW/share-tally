import { Router } from "express";
import type { ProfileReader } from "../identity/clerk-profiles.js";
import { getGroupUser } from "../identity/users.js";
import { BillError } from "../shared/bill-error.js";
import { isUuid } from "../shared/input-validation.js";
import { addBillNotePhoto, addDraftNotePhoto, notePhotoBytes, removeNotePhoto } from "./note-photos.js";

export function createNotePhotosRouter(profiles: ProfileReader) {
  const router = Router();
  const user = (id: string) => getGroupUser(id, profiles);
  for (const key of ["draftId", "billId", "photoId"])
    router.param(key, (_req, _res, next, id) =>
      next(isUuid(id) ? undefined : new BillError(404, "Record not found.")),
    );
  router.post("/receipt-drafts/:draftId/note-photos", async (req, res) => {
    const u = await user(res.locals.clerkUserId);
    res.status(201).json({ notePhoto: await addDraftNotePhoto(req.params.draftId, u.id, req.body) });
  });
  router.post("/bills/:billId/note-photos", async (req, res) => {
    const u = await user(res.locals.clerkUserId);
    res.status(201).json({ notePhoto: await addBillNotePhoto(req.params.billId, u.id, req.body) });
  });
  router.get("/note-photos/:photoId", async (req, res) => {
    const u = await user(res.locals.clerkUserId);
    res
      .type("image/jpeg")
      .set("X-Content-Type-Options", "nosniff")
      .send(await notePhotoBytes(req.params.photoId, u.id));
  });
  router.delete("/note-photos/:photoId", async (req, res) => {
    const u = await user(res.locals.clerkUserId);
    await removeNotePhoto(req.params.photoId, u.id);
    res.json({ deleted: true });
  });
  return router;
}

import { Router } from 'express';
import { BillError } from '../shared/bill-error.js';
import { isUuid } from '../shared/input-validation.js';
import { getGroupUser } from '../identity/users.js';
import { createRepayment, decideRepayment, parseRepayment } from './repayments.js';
import type { ProfileReader } from '../identity/clerk-profiles.js';

export function createRepaymentsRouter(profiles: ProfileReader) {
  const router = Router();
  for (const param of ['groupId', 'repaymentId']) router.param(param, (_req, _res, next, id) => {
    next(isUuid(id) ? undefined : new BillError(404, 'Record not found.'));
  });
  router.post('/groups/:groupId/repayments', async (req, res) => {
    const input = parseRepayment(req.body);
    const user = await getGroupUser(res.locals.clerkUserId, profiles);
    res.status(201).json({ repayment: await createRepayment(req.params.groupId.toLowerCase(), user.id, input) });
  });
  router.post('/repayments/:repaymentId/decision', async (req, res) => {
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).some(key => key !== 'decision') || !['confirmed', 'rejected'].includes(body.decision))
      throw new BillError(400, 'Choose confirmed or rejected.');
    const user = await getGroupUser(res.locals.clerkUserId, profiles);
    res.json({ repayment: await decideRepayment(req.params.repaymentId, user.id, body.decision) });
  });
  return router;
}

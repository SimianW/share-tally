import { createReceiptRouter } from './receipts/receipt-routes.js';
import { createNotePhotosRouter } from './note-photos/note-photo-routes.js';
import type { interpretReceiptNames } from './receipts/providers/receipt-names.js';
import type { ReceiptExtractor } from './receipts/processing/receipt-extraction.js';
import { readAttention } from './attention/attention.js';
import { openGroupEvents, openMemberEvents } from './realtime/group-events.js';
import { syncDisplayNames } from './workflows/sync-display-names.js';
import { getGroupUser } from './identity/users.js';
import { getGroupForMember } from './groups/groups.js';
import { createRepaymentsRouter } from './repayments/repayment-routes.js';
import { profileAvatars } from './identity/avatar-profile.js';
import { createAvatarReader, type AvatarLookup } from './identity/avatars.js';
import { createBillsRouter } from './bills/bill-routes.js';
import { BillError } from "./shared/bill-error.js";
import express, { type ErrorRequestHandler, type Request, type RequestHandler } from 'express';
import { clerkClient, clerkMiddleware, getAuth } from '@clerk/express';
import { getOrCreateUser } from './identity/users.js';
import { GroupAccessError, GroupDeletionError } from './groups/groups.js';
import { createGroupsRouter } from './groups/group-routes.js';
import { InvalidGroupIconError } from './groups/group-icon.js';
import { clerkProfiles, type ProfileReader } from './identity/clerk-profiles.js';

declare global {
  namespace Express {
    interface Locals { clerkUserId: string }
  }
}

type Authentication = {
  middleware: RequestHandler
  userId: (req: Request) => string | null
  expiresAt?: (req: Request) => number
  avatarUrl?: AvatarLookup
  receiptNames?: typeof interpretReceiptNames
  receiptExtractor?: ReceiptExtractor
  receiptProcessingSettled?: () => void
  profiles?: ProfileReader
};

// Authentication is the external boundary replaced by the test entry point.
// Normal startup supplies no override and always uses Clerk verification.
export function createApp(auth: Authentication = {
  avatarUrl: async id => {
    const user = await clerkClient.users.getUser(id);
    return profileAvatars(user);
  },
  middleware: clerkMiddleware(),
  expiresAt: req => (getAuth(req).sessionClaims?.exp ?? 0) * 1000,
  userId: (req) => {
    const { isAuthenticated, userId } = getAuth(req);
    return isAuthenticated ? userId : null;
  },
}) {
  const profiles = auth.profiles ?? clerkProfiles;
  const avatars = createAvatarReader(auth.avatarUrl ?? (async () => null));
  const app = express();

  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use('/api', auth.middleware, (req, res, next) => {
    const clerkUserId = auth.userId(req);
    if (!clerkUserId) { res.status(401).json({ error: 'Unauthorized' }); return; }
    res.locals.clerkUserId = clerkUserId;
    next();
  });
  app.use('/api', (req, res, next) => {
    const notePhoto = /^\/(receipt-drafts|bills)\/[^/]+\/note-photos$/.test(req.path);
    const receipt = /^\/(receipt-drafts\/|groups\/[^/]+\/(receipt-drafts|receipt-preview)|bills\/[^/]+\/(items|claims))/.test(req.path);
    // One compressed note photo is at most 1.5 MB, about 2 MB as base64.
    return express.json({ limit: notePhoto ? '2200kb' : receipt ? '12mb' : '16kb' })(req, res, next);
  });
  app.use('/api', createNotePhotosRouter(profiles));
  app.use('/api', createReceiptRouter(profiles, auth.receiptExtractor, auth.receiptNames, auth.receiptProcessingSettled));
  // Streams end at verified Clerk JWT expiry or after 30 seconds, then reauthenticate.
  const streamExpiry = (req: Request) => Math.min(auth.expiresAt?.(req) ?? Infinity, Date.now() + 30_000);
  app.get('/api/groups/:groupId/events', async (req, res) => {
    if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(req.params.groupId)) {
      res.status(404).json({ error: 'Group not found.' }); return;
    }
    const user = await getGroupUser(res.locals.clerkUserId, profiles);
    await getGroupForMember(req.params.groupId, user.id);
    const expiresAt = streamExpiry(req);
    if (expiresAt <= Date.now()) { res.status(401).end(); return; }
    if (!res.destroyed) openGroupEvents(req.params.groupId, res, expiresAt);
  });
  // Announces renamed members of any of this member's groups, for views such as Home.
  app.get('/api/me/events', async (req, res) => {
    const user = await getGroupUser(res.locals.clerkUserId, profiles);
    const expiresAt = streamExpiry(req);
    if (expiresAt <= Date.now()) { res.status(401).end(); return; }
    if (!res.destroyed) openMemberEvents(user.id, res, expiresAt);
  });
  // Rereads the signed-in user's own Clerk account after they edit it. The
  // request body is ignored: names come only from verified Clerk data.
  app.post('/api/me/profile', async (_req, res) => {
    const user = await getOrCreateUser(res.locals.clerkUserId);
    const { names, renamed } = await syncDisplayNames(profiles, [user.clerkUserId]);
    res.json({ displayName: names[0]?.displayName ?? user.displayName ?? 'Member', changed: renamed.length > 0 });
  });
  app.use('/api/groups', createGroupsRouter(profiles, avatars));
  app.use('/api', createBillsRouter(profiles, avatars));
  app.use('/api', createRepaymentsRouter(profiles));

  app.get('/api/attention', async (_req, res) => {
    const user = await getGroupUser(res.locals.clerkUserId, profiles);
    res.json({ actions: await readAttention(user.id) });
  });

  app.get('/api/me', async (req, res) => {
    const user = await getOrCreateUser(res.locals.clerkUserId);

    res.json({
      id: user.id,
      clerkUserId: user.clerkUserId,
    });
  });

  const handleError: ErrorRequestHandler = (error, _req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }

    if (error instanceof GroupAccessError || error instanceof BillError) {
      res.status(error.status).json({ error: error.message,
        ...(error instanceof GroupDeletionError ? { reasons: error.reasons } : {}),
        ...(error instanceof BillError && error.conflicts ? { conflicts: error.conflicts } : {}) });
      return;
    }

    if (error instanceof InvalidGroupIconError) {
      res.status(400).json({ error: error.message });
      return;
    }

    if (
      error instanceof Error &&
      'type' in error
    ) {
      if (error.type === 'entity.parse.failed') {
        res.status(400).json({ error: 'Invalid JSON body.' })
        return
      }

      if (error.type === 'entity.too.large') {
        res.status(413).json({ error: 'Request body is too large.' })
        return
      }
    }

    // Database exceptions can contain bound photo bytes; never retain them in logs.
    console.error('Request failed', (_req.path.includes('receipt-drafts') || _req.path.includes('receipt-preview') || _req.path.includes('note-photos')) ? (error instanceof Error ? error.name : 'UnknownError') : error);

    res.status(500).json({
      error: 'Internal Server Error'
    });
  };

  app.use(handleError);

  return app;
}

import express, { type ErrorRequestHandler, type Request, type RequestHandler } from 'express';
import { clerkClient, clerkMiddleware, getAuth } from '@clerk/express';
import { getOrCreateUser } from './users.js';
import { GroupAccessError } from './groups.js';
import { createGroupsRouter } from './group-routes.js';
import { InvalidGroupIconError } from './group-icon.js';

declare global {
  namespace Express {
    interface Locals { clerkUserId: string }
  }
}

type Authentication = {
  middleware: RequestHandler
  userId: (req: Request) => string | null
  displayName?: (clerkUserId: string) => Promise<string>
};

// Authentication is the external boundary replaced by the test entry point.
// Normal startup supplies no override and always uses Clerk verification.
export function createApp(auth: Authentication = {
  middleware: clerkMiddleware(),
  userId: (req) => {
    const { isAuthenticated, userId } = getAuth(req);
    return isAuthenticated ? userId : null;
  },
}) {
  const displayName = auth.displayName ?? (async (id: string) => {
    const user = await clerkClient.users.getUser(id);
    return [user.firstName, user.lastName].filter(Boolean).join(' ') || user.username || 'Member';
  });
  const app = express();

  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use(express.json({ limit: '16kb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use('/api', auth.middleware, (req, res, next) => {
    const clerkUserId = auth.userId(req);
    if (!clerkUserId) { res.status(401).json({ error: 'Unauthorized' }); return; }
    res.locals.clerkUserId = clerkUserId;
    next();
  });
  app.use('/api/groups', createGroupsRouter(displayName));

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

    if (error instanceof GroupAccessError) {
      res.status(error.status).json({ error: error.message });
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

    console.error('Request failed', error);

    res.status(500).json({
      error: 'Internal Server Error'
    });
  };

  app.use(handleError);

  return app;
}

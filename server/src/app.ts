import express, { type ErrorRequestHandler, type Request, type RequestHandler } from 'express'
import { clerkMiddleware, getAuth } from '@clerk/express'
import { getOrCreateUser } from './users.js'

type Authentication = {
  middleware: RequestHandler
  userId: (req: Request) => string | null
}

// Authentication is the external boundary replaced by the test entry point.
// Normal startup supplies no override and always uses Clerk verification.
export function createApp(auth: Authentication = {
  middleware: clerkMiddleware(),
  userId: (req) => {
    const { isAuthenticated, userId } = getAuth(req)
    return isAuthenticated ? userId : null
  },
}) {
  const app = express()
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' })
  })

  // have to use the clerk middleware before any routes that require authentication
  app.use(auth.middleware)

  app.get('/api/me', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store')

    const userId = auth.userId(req)

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }

    const user = await getOrCreateUser(userId)

    res.json({
      id: user.id,
      clerkUserId: user.clerkUserId,
    })
  })

  const handleError: ErrorRequestHandler = (error, _req, res, next) => {
    if (res.headersSent) {
      next(error)
      return
    }

    console.error('Request failed', error)

    res.status(500).json({
      error: 'Internal Server Error'
    })
  }

  app.use(handleError)

  return app
}

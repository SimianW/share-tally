import express from 'express'
import { clerkMiddleware, getAuth } from '@clerk/express'

const app = express()
const port = 3000

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' })
})

app.use(clerkMiddleware())

app.get('/api/me', (req, res) => {
  const { isAuthenticated, userId } = getAuth(req)

  if (!isAuthenticated) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  res.json({ clerkUserId: userId })
})

app.listen(port, '127.0.0.1', () => {
  console.log(`API listening at http://127.0.0.1:${port}`)
})

import { createApp } from './app.js'

const port = 3000
const host = process.env.HOST ?? '127.0.0.1'
const app = createApp()

app.listen(port, host, () => {
  console.log(`API listening at http://${host}:${port}`)
})

import { createApp } from './app.js'

const port = 3000
const app = createApp()

app.listen(port, '127.0.0.1', () => {
  console.log(`API listening at http://127.0.0.1:${port}`)
})

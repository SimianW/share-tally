import { purgeExpiredPhotos } from './receipt-drafts.js';
import { createApp } from './app.js';
import { startServer } from './start-server.js';

const port = 3000;
const host = process.env.HOST ?? '127.0.0.1';
const app = createApp();

await startServer(app, port, host);
console.log(`API listening at http://${host}:${port}`);

// Access checks deny expired photos immediately; remove stored bytes at startup and hourly.
const purge = () => void purgeExpiredPhotos().catch(() => console.error('Receipt photo cleanup failed'));
purge();
setInterval(purge, 60 * 60 * 1000).unref();

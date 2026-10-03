import { purgeExpiredPhotos } from "./receipts/drafts/photos.js";
import { createApp } from './app.js';
import { startServer } from './start-server.js';
import { clerkProfiles } from './identity/clerk-profiles.js';
import { syncDisplayNames } from './workflows/sync-display-names.js';

const port = 3000;
const host = process.env.HOST ?? '127.0.0.1';
const app = createApp();

await startServer(app, port, host);
console.log(`API listening at http://${host}:${port}`);

// Access checks deny expired photos immediately; remove stored bytes at startup and hourly.
const purge = () => void purgeExpiredPhotos().catch(() => console.error('Receipt photo cleanup failed'));
purge();
setInterval(purge, 60 * 60 * 1000).unref();

// Members' own edits sync when they save them. Startup and hourly passes also bring
// in users who are not signed in, and edits made outside ShareTally.
const syncNames = () => void syncDisplayNames(clerkProfiles).catch(() => console.error('Display name synchronization failed'));
syncNames();
setInterval(syncNames, 60 * 60 * 1000).unref();

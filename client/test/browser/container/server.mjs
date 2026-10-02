// Runs only in the browser image. Keep application origins identical to local
// tests: Chromium and route.fetch both reach Vite through this loopback relay.
import { once } from 'node:events';
import { createConnection, createServer } from 'node:net';
import { chromium } from 'playwright';

const appPort = Number(process.env.APP_PORT);
const relay = createServer({ noDelay: true }, socket => {
  const upstream = createConnection({ host: 'host.docker.internal', port: appPort, noDelay: true });
  socket.on('error', () => upstream.destroy());
  upstream.on('error', () => socket.destroy());
  socket.on('close', () => upstream.destroy());
  upstream.on('close', () => socket.destroy());
  socket.pipe(upstream).pipe(socket);
});
relay.listen(appPort, '127.0.0.1');
await once(relay, 'listening');

const remoteHost = process.env.APP_REMOTE_HOST;
const browser = await chromium.launchServer({
  host: '0.0.0.0', port: 3000, wsPath: process.env.BROWSER_WS_PATH,
  handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false,
  ...(remoteHost ? { args: [`--host-resolver-rules=MAP ${remoteHost} 127.0.0.1`, '--no-proxy-server'] } : {}),
});
// Do not log the websocket path: knowing it grants control of the browser.
console.log('Browser ready');

let stopping;
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.once(signal, () => {
  stopping ??= browser.close().finally(() => process.exit(0));
});

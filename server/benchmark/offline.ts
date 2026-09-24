import net from "node:net";
import http from "node:http";
import https from "node:https";
import tls from "node:tls";
import { syncBuiltinESMExports } from "node:module";

/** Defense against accidental network calls, not a sandbox for hostile local plugins. */
export async function offline<T>(run: () => Promise<T>): Promise<T> {
  const blocked = () => { throw new Error("Network access is disabled in the offline receipt benchmark."); };
  const saved = { fetch: globalThis.fetch, connect: net.Socket.prototype.connect, http: http.request, httpGet: http.get, https: https.request, httpsGet: https.get, tls: tls.connect };
  globalThis.fetch = blocked;
  net.Socket.prototype.connect = blocked;
  http.request = blocked; http.get = blocked;
  https.request = blocked; https.get = blocked; tls.connect = blocked;
  syncBuiltinESMExports();
  try { return await run(); }
  finally {
    globalThis.fetch = saved.fetch; net.Socket.prototype.connect = saved.connect;
    http.request = saved.http; http.get = saved.httpGet;
    https.request = saved.https; https.get = saved.httpsGet; tls.connect = saved.tls;
    syncBuiltinESMExports();
  }
}

import { once } from "node:events";
import type { Express } from "express";
import { sweepStaleProcessingDrafts } from "./receipts/drafts/processing.js";
import { stopReceiptCompletionRetries } from "./receipts/processing/receipt-reading.js";

// Production and HTTP integration tests share restart recovery before listening.
export async function startServer(app: Express, port: number, host: string) {
  const remaining = await sweepStaleProcessingDrafts();
  const server = app.listen(port, host);
  await once(server, "listening");
  // A recently interrupted job may not be stale yet during startup. Sweep
  // every two seconds while processing drafts remain, so a restart cannot add
  // another full model timeout. An idle API then leaves the database idle.
  // A failed sweep counts as work left. Drafts this process starts later
  // settle through their own deadline and completion retries.
  let closed = false;
  let recovery: ReturnType<typeof setTimeout> | undefined;
  const sweep = async () => {
    let more = true;
    try { more = await sweepStaleProcessingDrafts(); }
    catch { console.error("Receipt processing recovery failed"); }
    if (more && !closed) recovery = setTimeout(sweep, 2_000).unref();
  };
  if (remaining) recovery = setTimeout(sweep, 2_000).unref();
  server.once("close", () => {
    closed = true;
    clearTimeout(recovery);
    stopReceiptCompletionRetries();
  });
  return server;
}

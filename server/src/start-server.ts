import { once } from "node:events";
import type { Express } from "express";
import { sweepStaleProcessingDrafts } from "./receipt-drafts.js";

// Production and HTTP integration tests share restart recovery before listening.
export async function startServer(app: Express, port: number, host: string) {
  await sweepStaleProcessingDrafts();
  const server = app.listen(port, host);
  await once(server, "listening");
  // A recently interrupted job may not be stale yet during startup. Sweep
  // every two seconds so a restart cannot add another full model timeout.
  const recovery = setInterval(() => {
    void sweepStaleProcessingDrafts().catch(() => console.error("Receipt processing recovery failed"));
  }, 2_000);
  recovery.unref();
  server.once("close", () => clearInterval(recovery));
  return server;
}

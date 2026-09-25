import { setTimeout as delay } from "node:timers/promises";
import sharp from "sharp";
import type { AnalyzeResult } from "../src/azure-receipt.js";
import { normalizeReceiptPhoto } from "../src/receipt-photo.js";
import { AZURE_CONFIGS, type AzureConfig } from "./recordings.js";

export type Wait = (ms: number, signal: AbortSignal) => Promise<unknown>;
const defaultWait: Wait = (ms, signal) => delay(ms, undefined, { signal });

/**
 * The browser step of a production upload (client/src/play/ReceiptPhoto.tsx, uncropped): scale by
 * min(1, 2400 / width, 6000 / height) with rounded dimensions, then encode JPEG at quality 0.9.
 */
export async function clientUpload(image: Buffer): Promise<Buffer> {
  const { width, height } = await sharp(image).metadata();
  if (!width || !height) throw new Error("Committed image has no dimensions.");
  const ratio = Math.min(1, 2400 / width, 6000 / height);
  return sharp(image).resize(Math.max(1, Math.round(width * ratio)), Math.max(1, Math.round(height * ratio)), { fit: "fill" })
    .jpeg({ quality: 90 }).toBuffer();
}

/** The recording endpoint accepts only the committed redacted PNG, never source URLs. It then applies both
 * production upload steps, browser compression and server normalization, so Azure analyses the same bytes
 * a user upload of that image would produce. */
export async function analyzeAzureImage(
  image: Buffer, config: AzureConfig, env: NodeJS.ProcessEnv,
  request: typeof fetch = fetch, wait: Wait = defaultWait,
): Promise<AnalyzeResult> {
  const endpoint = env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT;
  const key = env.AZURE_DOCUMENT_INTELLIGENCE_KEY;
  if (!endpoint || !key) throw new Error("Set AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT and AZURE_DOCUMENT_INTELLIGENCE_KEY.");
  const base = new URL(endpoint);
  if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash)
    throw new Error("Azure endpoint must be HTTPS without credentials, query parameters or fragment.");
  const selected = AZURE_CONFIGS[config];
  const url = new URL(`/documentintelligence/documentModels/${selected.modelId}:analyze`, base);
  url.searchParams.set("api-version", selected.apiVersion);
  for (const [name, value] of Object.entries(selected.options))
    url.searchParams.set(name, Array.isArray(value) ? value.join(",") : String(value));
  const signal = AbortSignal.timeout(120_000);
  const headers = { "Ocp-Apim-Subscription-Key": key };
  const photo = await normalizeReceiptPhoto((await clientUpload(image)).toString("base64"));
  const response = await request(url, { method: "POST", headers: { ...headers, "Content-Type": "image/jpeg" }, body: new Uint8Array(photo), signal, redirect: "error" });
  if (!response.ok) throw new Error(`Azure analyze HTTP ${response.status}: ${(await response.text()).slice(0, 400)}`);
  const location = response.headers.get("operation-location");
  if (!location) throw new Error("Azure did not return an operation URL.");
  const operation = new URL(location);
  if (operation.protocol !== "https:" || operation.origin !== base.origin || operation.username || operation.password || operation.hash ||
      !operation.pathname.startsWith("/documentintelligence/documentModels/"))
    throw new Error("Azure returned an unexpected operation URL.");
  let pause = Number(response.headers.get("retry-after")) || 2;
  for (;;) {
    await wait(Math.min(Math.max(pause, 1), 10) * 1000, signal);
    signal.throwIfAborted();
    const poll = await request(operation, { headers, signal, redirect: "error" });
    if (!poll.ok) throw new Error(`Azure result HTTP ${poll.status}.`);
    const body = await poll.json() as { status?: string; analyzeResult?: AnalyzeResult };
    if (body.status === "succeeded") {
      if (!body.analyzeResult) throw new Error("Azure success did not include analyzeResult.");
      return body.analyzeResult;
    }
    if (body.status === "failed" || body.status === "canceled") throw new Error(`Azure ${body.status}.`);
    if (body.status !== "running" && body.status !== "notStarted") throw new Error("Azure returned an unknown operation status.");
    pause = Number(poll.headers.get("retry-after")) || 2;
  }
}

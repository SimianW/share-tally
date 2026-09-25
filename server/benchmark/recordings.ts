import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import type { AnalyzeResult } from "../src/azure-receipt.js";

export const AZURE_CONFIGS = {
  default: { apiVersion: "2024-11-30", modelId: "prebuilt-receipt", options: {} },
  "locale-en": { apiVersion: "2024-11-30", modelId: "prebuilt-receipt", options: { locale: "en" } },
  "ocr-high-resolution": { apiVersion: "2024-11-30", modelId: "prebuilt-receipt", options: { features: ["ocrHighResolution"] } },
} as const;
export type AzureConfig = keyof typeof AZURE_CONFIGS;
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const object = z.record(z.string(), z.unknown());
const analysisSchema = z.object({
  documents: z.array(z.object({ fields: object.optional() }).passthrough()).length(1),
  content: z.string().optional(),
  apiVersion: z.string().optional(),
  modelId: z.string().optional(),
}).passthrough();
const azureSchema = z.object({
  schemaVersion: z.literal(1),
  imageSha256: hash,
  request: z.object({ apiVersion: z.string(), modelId: z.string(), options: object }).strict(),
  analyzeResult: analysisSchema,
}).strict();
const modelSchema = z.object({
  schemaVersion: z.literal(1),
  version: z.string().min(1),
  config: object,
  input: z.unknown().refine((v) => v !== undefined, "input is required"),
  inputSha256: hash,
  // Stable source-order correlation IDs, not scoring labels or random new UUIDs.
  itemIds: z.array(z.string().min(1)).optional(),
  outcome: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("result"), value: z.unknown().refine((v) => v !== undefined, "value is required") }).strict(),
    z.object({ kind: z.literal("timeout") }).strict(),
    z.object({ kind: z.literal("skipped"), reason: z.enum(["no-items", "scan-failed"]) }).strict(),
    z.object({ kind: z.literal("error"), message: z.string().optional() }).strict(),
  ]),
}).strict();
export type ModelRecording = z.infer<typeof modelSchema>;
export type ModelOutcome = ModelRecording["outcome"];
export class RecordingError extends Error {}
export function canonicalJson(value: unknown): string {
  if (typeof value === "number" && !Number.isFinite(value)) throw new RecordingError("Replay numbers must be finite JSON numbers.");
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, v]) => `${JSON.stringify(key)}:${canonicalJson(v)}`).join(",")}}`;
  const result = JSON.stringify(value);
  if (result === undefined) throw new RecordingError("Replay inputs must contain only JSON values (no undefined).");
  return result;
}
export function inputHash(input: unknown) { return createHash("sha256").update(canonicalJson(input)).digest("hex"); }
export async function readJson(path: string): Promise<unknown | null> {
  try {
    const value: unknown = JSON.parse(await readFile(path, "utf8"));
    // null is the absence sentinel only for ENOENT, never a valid file envelope.
    if (value === null) throw new RecordingError("JSON null is not a valid benchmark document.");
    return value;
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new RecordingError(`Cannot read ${path}: ${String(error)}`);
  }
}
export function validateAzureRecording(value: unknown, imageSha256: string, config: AzureConfig): AnalyzeResult {
  const parsed = azureSchema.parse(value);
  if (parsed.imageSha256 !== imageSha256) throw new RecordingError("Azure recording imageSha256 does not match committed image.");
  if (!isDeepStrictEqual(parsed.request, AZURE_CONFIGS[config])) throw new RecordingError(`Azure request does not match ${config}; configurations cannot substitute for each other.`);
  if ((parsed.analyzeResult.apiVersion && parsed.analyzeResult.apiVersion !== parsed.request.apiVersion) ||
      (parsed.analyzeResult.modelId && parsed.analyzeResult.modelId !== parsed.request.modelId)) throw new RecordingError("Azure response/request metadata mismatch.");
  return parsed.analyzeResult as AnalyzeResult;
}
export function validateModelRecording(value: unknown): ModelRecording {
  const parsed = modelSchema.parse(value);
  if (inputHash(parsed.input) !== parsed.inputSha256) throw new RecordingError("Model recording inputSha256 mismatch.");
  if (parsed.itemIds && new Set(parsed.itemIds).size !== parsed.itemIds.length) throw new RecordingError("Duplicate recorded item IDs.");
  return parsed;
}
export function recordedItemIds(recording: ModelRecording | null, count: number): string[] {
  if (recording?.itemIds) {
    if (recording.itemIds.length !== count) throw new RecordingError("Recorded item IDs do not match source item count.");
    return [...recording.itemIds];
  }
  return Array.from({ length: count }, (_, i) => String(i));
}
export function replayModel(recording: ModelRecording | null, input: unknown, expected: { version: string; config: Record<string, unknown> }): ModelOutcome {
  if (!recording) throw new RecordingError("Model response not recorded.");
  if (recording.version !== expected.version || !isDeepStrictEqual(recording.config, expected.config)) throw new RecordingError("Model version/config drift.");
  // Round-trip mirrors JSON serialization (e.g. omitted optional context.text).
  const wireInput: unknown = JSON.parse(JSON.stringify(input));
  if (inputHash(wireInput) !== recording.inputSha256 || !isDeepStrictEqual(wireInput, recording.input)) throw new RecordingError("Model input drift; record this exact pipeline input before replay.");
  return structuredClone(recording.outcome);
}

/** Explicit evidence of a production no-call path, not a fabricated provider request/response. */
export function noModelInput(evidence: unknown, reason: "no-items" | "scan-failed" = "no-items") {
  return JSON.parse(JSON.stringify({ kind: "no-model-call", reason, evidence })) as Record<string, unknown>;
}

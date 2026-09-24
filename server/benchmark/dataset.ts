import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import { readJson, RecordingError } from "./recordings.js";
import type { ReceiptLabel } from "./scorer.js";

export interface DatasetEntry { id: string; label: ReceiptLabel; imageSha256?: string; fixture?: string }
const entrySchema = z.object({ id: z.string().regex(/^[a-zA-Z0-9_-]+$/), groundTruth: z.string().min(1), image: z.string().nullable().optional(), imageSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(), fixture: z.string().optional() }).passthrough();
// Full corpus arithmetic/provenance validation stays in validate_receipts.py.
// Here reject malformed inputs instead of quietly treating them as missing recordings.
const money = z.number().int().nullable();
const labelSchema = z.object({
  schemaVersion: z.literal(1), id: z.string(), merchant: z.string().nullable(), currency: z.string().nullable(),
  items: z.array(z.object({ id: z.string(), description: z.string().nullable(), quantity: z.string().nullable(), unit: z.string().nullable(), productCode: z.string().nullable(), unitPrice: money, linePrice: money, ownDiscount: money }).passthrough()),
  subtotal: money, subtotalBasis: z.string().nullable().optional(), taxTotal: money, total: money,
  receiptDiscounts: z.array(z.object({ label: z.string(), amount: money })).nullable(),
  charges: z.array(z.object({ label: z.string(), amount: money, stage: z.string().optional() })).nullable(),
  taxLines: z.array(z.object({ label: z.string(), amount: money, rate: z.string().nullable() }).passthrough()).nullable(),
  taxMode: z.enum(["inclusive", "exclusive"]).nullable(), rounding: money,
  taxability: z.array(z.object({ itemId: z.string(), taxable: z.boolean().nullable() }).passthrough()).nullable(),
}).passthrough();
async function readManifest(path: string, legacy: boolean): Promise<DatasetEntry[]> {
  const data = await readJson(path);
  if (data === null) throw new RecordingError(`Missing manifest ${path}`);
  const entries = z.array(entrySchema).parse(data);
  const result: DatasetEntry[] = [];
  for (const entry of entries) {
    const label = labelSchema.parse(await readJson(resolve(dirname(path), entry.groundTruth)));
    if (label.id !== entry.id) throw new RecordingError(`Label/manifest ID mismatch: ${entry.id}`);
    if (new Set(label.items.map((item) => item.id)).size !== label.items.length) throw new RecordingError(`Duplicate label item IDs: ${entry.id}`);
    if (legacy) {
      if (!entry.fixture) throw new RecordingError(`Missing legacy fixture: ${entry.id}`);
      result.push({ id: entry.id, label: label as ReceiptLabel, fixture: resolve(dirname(path), entry.fixture) });
    } else {
      if (!entry.image || !entry.imageSha256) throw new RecordingError(`Missing image provenance: ${entry.id}`);
      const bytes = await readFile(resolve(dirname(path), entry.image));
      const digest = createHash("sha256").update(bytes).digest("hex");
      if (digest !== entry.imageSha256) throw new RecordingError(`Committed image hash mismatch: ${entry.id}`);
      result.push({ id: entry.id, label: label as ReceiptLabel, imageSha256: digest });
    }
  }
  return result;
}
export async function loadDataset(root: string) {
  const publicEntries: DatasetEntry[] = [];
  for (const dir of (await readdir(resolve(root, "receipts"), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!dir.isDirectory() || dir.name === "owner-slots") continue;
    publicEntries.push(...await readManifest(resolve(root, "receipts", dir.name, "manifest.json"), false));
  }
  if (new Set(publicEntries.map((entry) => entry.id)).size !== publicEntries.length) throw new RecordingError("Duplicate public receipt IDs.");
  const legacyPath = resolve(root, "legacy", "manifest.json");
  const legacyEntries = await readJson(legacyPath) === null ? [] : await readManifest(legacyPath, true);
  return { publicEntries, legacyEntries };
}

import { interpretReceiptNames, receiptNameConfig } from "../src/receipt-names.js";
import { candidateDraft, candidateScanFailedInput, candidateScanFails, CANDIDATE_ID, CANDIDATE_MODEL_VERSION } from "./candidate.js";
import type { CandidateRecorder } from "./record.js";
import { noModelInput, type ModelOutcome } from "./recordings.js";

/** Owner-only live adapter; the generic recorder supplies explicit consent and mocked tests. */
export const candidateRecorder: CandidateRecorder = {
  id: CANDIDATE_ID, version: CANDIDATE_MODEL_VERSION,
  async record({ analysis, env, request }) {
    const provider = receiptNameConfig(env);
    const config = { baseURL: provider.baseURL, model: provider.model };
    if (candidateScanFails(analysis)) {
      return { config, input: candidateScanFailedInput(config), itemIds: [], outcome: { kind: "skipped", reason: "scan-failed" } };
    }
    const { evidence, items } = candidateDraft(analysis);
    const itemIds = items.map((item) => item.id);
    let input: unknown;
    let raw: {} | null = null;
    let captured = false;
    let outcome: ModelOutcome;
    try {
      // Use the production HTTP call and parser, not a parallel prompt or a fake envelope.
      await interpretReceiptNames(evidence, provider, async (url, init) => {
        input = JSON.parse(String(init?.body));
        const response = await request(url, init);
        if (response.ok) {
          try { raw = await response.clone().json(); captured = true; }
          catch { /* Invalid JSON is a real provider error, not a made-up envelope. */ }
        }
        return response;
      });
      outcome = items.length ? { kind: "result", value: raw } : { kind: "skipped", reason: "no-items" };
    } catch (error) {
      // Preserve actual envelopes even when production rejects their structure/content.
      // Never save exception strings, headers or error bodies containing provider secrets.
      outcome = captured ? { kind: "result", value: raw }
        : error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)
          ? { kind: "timeout" } : { kind: "error", message: "Model request failed." };
    }
    if (!items.length) input = noModelInput({ config, evidence });
    if (input === undefined) throw new Error("Candidate did not produce a model request or no-call marker.");
    return { config, input, itemIds, outcome };
  },
};
export default candidateRecorder;

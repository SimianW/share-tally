import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFile } from "node:fs/promises";
import { runBenchmark, readableReport } from "./runner.js";

const help = `Offline receipt benchmark
Usage: pnpm benchmark [--candidate ./candidate.ts] [--json [report.json]] [--allow-incomplete]
  --candidate PATH     Trusted local module exporting BenchmarkAdapter (default or adapter).
  --recordings PATH    Override recording root (default benchmark/recordings).
  --root PATH          Override benchmark corpus root (primarily for tests).
  --json [PATH]        Emit full JSON to stdout, or write it to PATH plus readable stdout.
  --allow-incomplete   Diagnostics only: return 0 for INCOMPLETE, never for a regression.
  --help               Show this help.
Exit codes: 0 pass; 1 any regression; 2 incomplete, malformed input or usage error.
The default compares the frozen baseline with the built-in two-stage (#51+#52) candidate. No network is permitted.
`;
async function main() {
  const args = process.argv.slice(2).filter((arg) => arg !== "--");
  let root = dirname(fileURLToPath(import.meta.url));
  let candidate: string | undefined;
  let recordings: string | undefined;
  let json: boolean | string = false;
  let allowIncomplete = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--help") { process.stdout.write(help); return; }
    if (arg === "--allow-incomplete") { allowIncomplete = true; continue; }
    if (arg === "--json") { json = args[i + 1] && !args[i + 1]!.startsWith("--") ? resolve(args[++i]!) : true; continue; }
    if (["--candidate", "--recordings", "--root"].includes(arg)) {
      const value = args[++i];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
      if (arg === "--candidate") candidate = resolve(value);
      if (arg === "--recordings") recordings = resolve(value);
      if (arg === "--root") root = resolve(value);
      continue;
    }
    throw new Error(`Unknown argument ${arg}`);
  }
  const report = await runBenchmark({ root, candidate, recordings });
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (typeof json === "string") await writeFile(json, serialized);
  process.stdout.write(json === true ? serialized : readableReport(report));
  const invalid = [...report.public.receipts, ...report.legacy.receipts].some((row) => row.errors.length > 0);
  process.exitCode = report.gate.status === "regression" ? 1 : invalid || (report.gate.status === "incomplete" && !allowIncomplete) ? 2 : 0;
}
main().catch((error: unknown) => {
  process.stderr.write(`Benchmark input error: ${String(error)}\n`);
  process.exitCode = 2;
});

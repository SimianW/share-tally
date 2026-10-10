// Chooses the scenarios run.mjs runs from its command-line arguments:
// --all selects every suite, so the release gate cannot miss a new one.
// Scenario names select just those scenarios, even after a suite name
// (`pnpm test:receipts scan-fallback`); suite names alone select whole suites.
export function selectScenarios(suites, args) {
  const all = Object.entries(suites).flatMap(([suite, scenarios]) => scenarios.map(scenario => ({ suite, ...scenario })));
  const names = args.filter(arg => arg !== '--all');
  const unknown = names.filter(arg => !suites[arg] && !all.some(({ name }) => name === arg));
  if (unknown.length) return { unknown, scenarios: [] };
  if (args.includes('--all')) return { unknown, scenarios: all };
  const named = all.filter(({ name }) => names.includes(name));
  return { unknown, scenarios: named.length ? named : all.filter(({ suite }) => names.includes(suite)) };
}

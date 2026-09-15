export type Engine = 'ai-sdk' | 'receipt-scanner';
export type Fixture = {
  id: string; name: string; tag: string; description: string; source: string; annotation: string;
  groundTruthNote?: string; reviewNotes?: Partial<Record<Engine, string>>;
  expected: {
    currency: string; currencyPrinted?: boolean; total: number; itemCount: number; lineAmounts: number[];
    discount: number | null; rounding: number | null; taxTotal?: number | null;
    quantities?: (number | null)[]; unitPrices?: (number | null)[]; itemDescriptions?: string[];
  };
};
export type Receipt = {
  merchant: string | { name: string } | null; currency: string | null;
  total: number | null; subtotal: number | null; discountTotal: number | null;
  roundingAdjustment?: number | null; taxes?: { label: string; amount: number }[];
  items: { description: string; quantity: number | null; unitPrice: number | null; totalPrice: number }[];
  warnings?: string[];
};
export type Result = {
  engine: Engine; receiptId: string; model: string; ranAt: string; durationMs: number;
  status?: 'success' | 'error'; error?: string; data?: Receipt; usage?: unknown; raw?: string;
};
export type Check = { label: string; status: 'pass' | 'fail' | 'na' | 'pending' | 'error'; expected: string; actual: string };
const sameMoney = (actual: number | null | undefined, expected: number) => typeof actual === 'number' && Number.isFinite(actual) && Math.round(actual * 100) === Math.round(expected * 100);
const currency = (value: string | null | undefined) => {
  const upper = value?.trim().toUpperCase();
  return ({ RM: 'MYR', DH: 'MAD', DHS: 'MAD' } as Record<string, string>)[upper ?? ''] ?? upper;
};
const text = (value: unknown) => value == null ? 'Not provided' : Array.isArray(value) ? value.map(v => v == null ? '—' : v).join(' / ') : String(value);
export function evaluateChecks(fixture: Fixture, result?: Result): Check[] {
  const e = fixture.expected;
  const d = result?.data;
  function check(label: string, expected: unknown, actual: unknown, passed: boolean, applicable = true): Check {
    const status = !applicable ? 'na' : !result ? 'pending' : !d ? 'error' : passed ? 'pass' : 'fail';
    return { label, status, expected: text(expected), actual: text(actual) };
  }
  function fieldList(label: string, expected: (number | null)[] | undefined, key: 'quantity' | 'unitPrice') {
    const actual = d?.items.map(i => i[key]);
    const applicable = Boolean(expected?.some(v => v != null));
    const passed = Boolean(expected && actual && actual.length === expected.length && expected.every((v, i) => v == null || (actual[i] != null && Math.abs(actual[i]! - v) < 0.00001)));
    return check(label, expected, actual, passed, applicable);
  }
  const tax = d?.taxes?.reduce((sum, entry) => sum + entry.amount, 0);
  return [
    check('Total', e.total, d?.total, sameMoney(d?.total, e.total)),
    check('Priced rows', e.itemCount, d?.items.length, d?.items.length === e.itemCount),
    check('Line amounts', e.lineAmounts, d?.items.map(i => i.totalPrice), Boolean(d && d.items.length === e.lineAmounts.length && d.items.every((item, i) => sameMoney(item.totalPrice, e.lineAmounts[i])))),
    fieldList('Quantities', e.quantities, 'quantity'),
    fieldList('Unit prices', e.unitPrices, 'unitPrice'),
    check('Currency', e.currencyPrinted === false ? `${e.currency} or unknown (not printed)` : e.currency, d?.currency, currency(d?.currency) === e.currency || (e.currencyPrinted === false && d?.currency == null)),
    check('Discount', e.discount, d?.discountTotal, e.discount != null && sameMoney(d?.discountTotal, e.discount), e.discount != null),
    check('Tax', e.taxTotal, tax, e.taxTotal != null && sameMoney(tax, e.taxTotal), e.taxTotal != null),
  ];
}
export function matchesAll(fixture: Fixture, result?: Result) {
  return Boolean(result?.data && evaluateChecks(fixture, result).every(c => c.status === 'pass' || c.status === 'na'));
}

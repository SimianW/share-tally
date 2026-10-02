
export const money = (cents: number) =>
  new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(
    cents / 100,
  );
export function parseMoney(value: string) {
  if (!/^\d+(\.\d{1,2})?$/.test(value.trim()))
    throw new Error("Enter an amount with at most two decimal places.");
  const [whole, fraction = ""] = value.trim().split(".");
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(result) || result > 1000000)
    throw new Error("Amounts cannot exceed CAD 10,000.00.");
  return result;
}

export const amountText = (cents: number) => (cents / 100).toFixed(2);

export function signedMoney(cents: number, positive: 'always' | 'nonzero' | 'never' = 'never') {
  if (cents < 0) return `−${money(-cents)}`;
  return `${positive === 'always' || (positive === 'nonzero' && cents > 0) ? '+' : ''}${money(cents)}`;
}

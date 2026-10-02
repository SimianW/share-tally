import { BillError } from "./bill-error.js";

export function safeCents(value: bigint) {
  const number = Number(value);
  if (!Number.isSafeInteger(number))
    throw new BillError(422, "Balance exceeds the supported range.");
  return number;
}

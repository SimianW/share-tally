import { BillError } from "./bill-error.js";

export const isUuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
export function cents(value: unknown, max = 1000000): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > max
  )
    throw new BillError(
      400,
      `Amount must be integer cents between 0 and ${max}.`,
    );
  return value;
}

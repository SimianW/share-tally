import { BillError } from '../shared/bill-error.js';
import { cents, isUuid } from '../shared/input-validation.js';
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new BillError(400, "Expected a JSON object.");
  return value as Record<string, unknown>;
}
function parseRevision(value: unknown) {
  const body = object(value);
  if (!Number.isSafeInteger(body.revision) || Number(body.revision) < 1)
    throw new BillError(400, "A positive bill revision is required.");
  return Number(body.revision);
}
export function parseAction(value: unknown) {
  const body = object(value);
  if (Object.keys(body).some((key) => key !== "revision"))
    throw new BillError(400, "Unexpected action field.");
  return parseRevision(body);
}
export function parseShare(value: unknown) {
  const body = object(value);
  if (
    Object.keys(body).some(
      (key) =>
        !["amountCents", "expectedAmountCents", "revision"].includes(key),
    )
  )
    throw new BillError(400, "Submit only your own share.");
  return {
    amount: cents(body.amountCents),
    revision: parseRevision(body),
    expectedAmount:
      body.expectedAmountCents === null
        ? null
        : cents(body.expectedAmountCents),
  };
}
export function parseEdit(value: unknown) {
  const body = object(value);
  const revision = parseRevision(body);
  const { revision: _, ...details } = body;
  if ("requestId" in details || "ownShareCents" in details)
    throw new BillError(400, "Bill edits cannot change participant amounts.");
  const { requestId: _request, ...input } = parseBill({
    ...details,
    requestId: "00000000-0000-4000-8000-000000000000",
  });
  return { ...input, revision };
}
export function parseBill(value: unknown) {
  const body = object(value);
  const allowed = [
    "requestId",
    "title",
    "purchaseDate",
    "timeZone",
    "notes",
    "totalCents",
    "participantIds",
  ];
  if (Object.keys(body).some((key) => !allowed.includes(key)))
    throw new BillError(400, "Unexpected bill field.");
  if (!isUuid(body.requestId))
    throw new BillError(400, "A UUID requestId is required.");
  if (
    typeof body.title !== "string" ||
    !body.title.trim() ||
    [...body.title.trim()].length > 120 ||
    /\p{Cc}/u.test(body.title)
  )
    throw new BillError(
      400,
      "Title must contain 1 to 120 characters without control characters.",
    );
  const notes = body.notes ?? "";
  if (
    typeof notes !== "string" ||
    [...notes].length > 2000 ||
    notes.includes("\0")
  )
    throw new BillError(400, "Notes must contain at most 2,000 characters.");
  if (
    typeof body.purchaseDate !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(body.purchaseDate) ||
    body.purchaseDate < "0001-01-01" ||
    !Number.isFinite(Date.parse(body.purchaseDate)) ||
    new Date(body.purchaseDate).toISOString().slice(0, 10) !== body.purchaseDate
  )
    throw new BillError(400, "Enter a valid purchase date.");
  let today: string;
  try {
    if (typeof body.timeZone !== "string") throw new Error();
    today = new Intl.DateTimeFormat("en-CA", {
      timeZone: body.timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  } catch {
    throw new BillError(400, "A valid device time zone is required.");
  }
  if (body.purchaseDate > today)
    throw new BillError(400, "Purchase date cannot be in the future.");
  const totalCents = cents(body.totalCents);
  if (totalCents === 0)
    throw new BillError(400, "Bill total must be positive.");
  if (
    !Array.isArray(body.participantIds) ||
    !body.participantIds.length ||
    !body.participantIds.every(isUuid)
  )
    throw new BillError(400, "Select group participants.");
  const participantIds = body.participantIds
    .map((id) => id.toLowerCase())
    .sort();
  if (new Set(participantIds).size !== participantIds.length)
    throw new BillError(400, "Participants must be unique.");
  return {
    requestId: body.requestId.toLowerCase(),
    title: body.title.trim(),
    purchaseDate: body.purchaseDate,
    notes,
    totalCents,
    participantIds,
  };
}

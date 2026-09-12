export type Theme = "play" | "gather" | "orbit";
export type View = "overview" | "groups" | "activity" | "settlements";
export type Group = {
  id: string;
  name: string;
  description: string;
  icon: "basket" | "home" | "sun";
  color: string;
  members: string[];
};
export type Bill = {
  id: string;
  title: string;
  groupId: string;
  participants: string[];
  total: number;
  share: number | null;
  initiator: string;
  status: "pending" | "complete" | "settled";
  date: string;
};
export type Activity = {
  id: string;
  person: string;
  text: string;
  detail: string;
  date: string;
};
export type DemoData = {
  version: 2;
  groups: Group[];
  bills: Bill[];
  activity: Activity[];
  received: boolean;
};

export const storageKey = "sharetally.demo.v1";
export const seed: DemoData = {
  version: 2,
  received: false,
  groups: [
    {
      id: "costco",
      name: "Costco crew",
      description: "Big carts. Good company.",
      icon: "basket",
      color: "lime",
      members: ["Simon", "Emma", "Alex", "Jamie"],
    },
    {
      id: "home",
      name: "The home team",
      description: "Our place, our little things.",
      icon: "home",
      color: "lavender",
      members: ["Simon", "Emma", "Alex"],
    },
    {
      id: "weekend",
      name: "Weekend people",
      description: "For the plans that make it out of the chat.",
      icon: "sun",
      color: "peach",
      members: ["Simon", "Emma", "Jamie", "Alex", "Riley"],
    },
  ],
  bills: [
    {
      id: "b1",
      title: "The big Costco run",
      groupId: "costco",
      participants: ["Simon", "Emma", "Alex", "Jamie"],
      total: 18720,
      share: null,
      initiator: "Emma",
      status: "pending",
      date: "2026-09-07",
    },
    {
      id: "b2",
      title: "Sunday brunch",
      groupId: "weekend",
      participants: ["Simon", "Emma", "Jamie", "Alex", "Riley"],
      total: 9650,
      share: 2250,
      initiator: "Simon",
      status: "complete",
      date: "2026-09-06",
    },
    {
      id: "b3",
      title: "A few things for home",
      groupId: "home",
      participants: ["Simon", "Emma", "Alex"],
      total: 8400,
      share: 2800,
      initiator: "Alex",
      status: "complete",
      date: "2026-09-05",
    },
    {
      id: "b4",
      title: "Snacks for everyone",
      groupId: "costco",
      participants: ["Simon", "Emma", "Alex", "Jamie"],
      total: 7200,
      share: 1800,
      initiator: "Simon",
      status: "complete",
      date: "2026-09-04",
    },
    {
      id: "b5",
      title: "Coffee & a catch-up",
      groupId: "weekend",
      participants: ["Simon", "Emma", "Jamie", "Alex", "Riley"],
      total: 3600,
      share: 900,
      initiator: "Jamie",
      status: "settled",
      date: "2026-09-02",
    },
  ],
  activity: [
    {
      id: "a1",
      person: "Emma",
      text: "added a new bill",
      detail: "The big Costco run · $187.20",
      date: "2026-09-07",
    },
    {
      id: "a2",
      person: "Alex",
      text: "confirmed their share",
      detail: "A few things for home · $28.00",
      date: "2026-09-05",
    },
    {
      id: "a3",
      person: "Jamie",
      text: "sent you a repayment",
      detail: "Weekend people · $24.50",
      date: "2026-09-04",
    },
  ],
};

// A deliberately local UI fixture, independent of the application's future ledger.
export function readDemo(): DemoData {
  try {
    const value = migrateDemo(
      JSON.parse(localStorage.getItem(storageKey) || "null"),
    );
    if (isDemoData(value)) return value;
  } catch {
    /* An unavailable or outdated cache falls back to the demo. */
  }
  return structuredClone(seed);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Old demos included every group member. Preserve those bills and any user edits.
// Keep the storage key stable; the upgraded payload is saved on the next edit.
function migrateDemo(value: unknown): unknown {
  if (!isRecord(value) || value.version !== 1) return value;
  const { groups, bills } = value;
  if (!Array.isArray(groups) || !Array.isArray(bills)) return value;
  return {
    ...value,
    version: 2,
    bills: bills.map((bill: unknown) => {
      if (!isRecord(bill) || "participants" in bill) return bill;
      const group = groups.find(
        (g: unknown) => isRecord(g) && g.id === bill.groupId,
      );
      return {
        ...bill,
        participants:
          isRecord(group) && Array.isArray(group.members)
            ? [...group.members]
            : undefined,
      };
    }),
  };
}

function isDemoData(value: unknown): value is DemoData {
  if (!value || typeof value !== "object") return false;
  const d = value as Partial<DemoData>;
  return (
    d.version === 2 &&
    typeof d.received === "boolean" &&
    Array.isArray(d.groups) &&
    d.groups.length > 0 &&
    d.groups.every(
      (g) =>
        g &&
        typeof g.id === "string" &&
        typeof g.name === "string" &&
        typeof g.description === "string" &&
        ["basket", "home", "sun"].includes(g.icon) &&
        ["lime", "lavender", "peach"].includes(g.color) &&
        Array.isArray(g.members) &&
        g.members.includes("Simon") &&
        new Set(g.members).size === g.members.length &&
        g.members.every((m) => typeof m === "string"),
    ) &&
    Array.isArray(d.bills) &&
    d.bills.every(
      (b) =>
        b &&
        typeof b.id === "string" &&
        typeof b.title === "string" &&
        d.groups?.some((g) => g.id === b.groupId) &&
        Number.isSafeInteger(b.total) &&
        b.total > 0 &&
        (b.share === null ||
          (Number.isSafeInteger(b.share) &&
            b.share >= 0 &&
            b.share <= b.total)) &&
        typeof b.initiator === "string" &&
        Array.isArray(b.participants) &&
        b.participants.includes(b.initiator) &&
        new Set(b.participants).size === b.participants.length &&
        b.participants.every(
          (name) =>
            typeof name === "string" &&
            d.groups?.find((g) => g.id === b.groupId)?.members.includes(name),
        ) &&
        ["pending", "complete", "settled"].includes(b.status) &&
        typeof b.date === "string",
    ) &&
    Array.isArray(d.activity) &&
    d.activity.every(
      (a) =>
        a &&
        ["id", "person", "text", "detail", "date"].every(
          (k) => typeof a[k as keyof Activity] === "string",
        ),
    )
  );
}

export const money = (cents: number) =>
  new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(
    cents / 100,
  );
export const shortDate = (date: string) =>
  new Date(`${date}T12:00:00`).toLocaleDateString("en-CA", {
    month: "short",
    day: "numeric",
  });
export const today = () => new Date().toLocaleDateString("en-CA");
// getRandomValues also works on the local network's HTTP demo preview.
export function newDemoId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export const needsMyShare = (bill: Bill) =>
  bill.status === "pending" &&
  bill.participants.includes("Simon") &&
  bill.share === null;

export function readTheme(): Theme {
  const query = new URLSearchParams(window.location.search).get("design");
  if (query === "play" || query === "gather" || query === "orbit") return query;
  try {
    const saved = localStorage.getItem("sharetally.design");
    if (saved === "play" || saved === "gather" || saved === "orbit")
      return saved;
  } catch {
    /* Theme persistence is optional. */
  }
  return "play";
}

export function balances(bills: Bill[]) {
  const complete = bills.filter(
    (b) => b.status === "complete" && b.participants.includes("Simon"),
  );
  const owed = complete
    .filter((b) => b.initiator === "Simon")
    .reduce((sum, b) => sum + b.total - (b.share ?? 0), 0);
  const owing = complete
    .filter((b) => b.initiator !== "Simon")
    .reduce((sum, b) => sum + (b.share ?? 0), 0);
  return { owed, owing, net: owed - owing };
}

import type { CSSProperties, ReactNode } from "react";
import { money, shortDate, type Activity, type Bill, type Group } from "./data";

const paths = {
  grid: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="2" />
      <rect x="14" y="3" width="7" height="7" rx="2" />
      <rect x="3" y="14" width="7" height="7" rx="2" />
      <rect x="14" y="14" width="7" height="7" rx="2" />
    </>
  ),
  people: (
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
      <circle cx="9" cy="7" r="4" />
    </>
  ),
  activity: (
    <>
      <path d="M3 12h4l3-8 4 16 3-8h4" />
    </>
  ),
  arrows: (
    <>
      <path d="M4 7h16m-5-5 5 5-5 5M20 17H4m5-5-5 5 5 5" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  arrow: <path d="M5 12h14m-6-6 6 6-6 6" />,
  diagonal: <path d="M6 18 18 6H7m11 0v11" />,
  down: <path d="m6 9 6 6 6-6" />,
  check: <path d="m5 12 4 4L19 6" />,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  bell: (
    <>
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
    </>
  ),
  basket: (
    <>
      <path d="m8 3-4 7m12-7 4 7M2 10h20l-3 11H5L2 10Z M9 14v3m6-3v3" />
    </>
  ),
  home: (
    <>
      <path d="m3 10 9-7 9 7v11H3V10Z M9 21v-8h6v8" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" />
    </>
  ),
  receipt: (
    <>
      <path d="M5 3l3 2 4-2 4 2 3-2v18l-3-2-4 2-4-2-3 2V3Z M9 9h6m-6 4h6" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  heart: (
    <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z" />
  ),
  spark: (
    <>
      <path d="m12 2 2.8 7.2L22 12l-7.2 2.8L12 22l-2.8-7.2L2 12l7.2-2.8L12 2Z" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="m9 3-1 3-3 1-2 5 2 5 3 1 1 3h6l1-3 3-1 2-5-2-5-3-1-1-3H9Z" />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof paths;
export function Icon({
  name,
  size = 20,
  className = "",
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="brand">
      <span className="brand-mark" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      {!compact && (
        <span>
          share<span className="brand-light">tally</span>
          <span className="brand-period">.</span>
        </span>
      )}
    </span>
  );
}
export function Avatar({
  name,
  small = false,
}: {
  name: string;
  small?: boolean;
}) {
  const colors: Record<string, string> = {
    Simon: "#e5edc5",
    Emma: "#edcee0",
    Alex: "#c4dce9",
    Jamie: "#f2d0ae",
    Riley: "#d7d0ec",
  };
  return (
    <span
      className={`avatar ${small ? "small" : ""}`}
      style={{ "--avatar-color": colors[name] || "#d8dfd0" } as CSSProperties}
      title={name}
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}
export function Avatars({ names }: { names: string[] }) {
  return (
    <span className="avatar-stack" aria-label={names.join(", ")}>
      {names.slice(0, 4).map((n) => (
        <Avatar key={n} name={n} small />
      ))}
      {names.length > 4 && (
        <span className="avatar avatar-more small">+{names.length - 4}</span>
      )}
    </span>
  );
}
export function Button({
  children,
  onClick,
  variant = "primary",
  className = "",
  type = "button",
  disabled = false,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "text";
  className?: string;
  type?: "button" | "submit";
  disabled?: boolean;
}) {
  return (
    <button
      type={type}
      className={`button ${variant} ${className}`}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
export function SectionHeading({
  title,
  action,
  onAction,
  count,
}: {
  title: string;
  action?: string;
  onAction?: () => void;
  count?: number;
}) {
  return (
    <div className="section-heading">
      <h2>
        {title}
        {count !== undefined && <span className="count">{count}</span>}
      </h2>
      {action && (
        <button className="text-action" onClick={onAction}>
          {action}
          <Icon name="arrow" size={16} />
        </button>
      )}
    </div>
  );
}
export function GroupCards({
  groups,
  bills,
  onGroup,
  onCreate,
}: {
  groups: Group[];
  bills: Bill[];
  onGroup: (id: string) => void;
  onCreate?: () => void;
}) {
  return (
    <div className="group-grid">
      {groups.map((group, i) => {
        const pending = bills.filter(
          (b) => b.groupId === group.id && b.status === "pending",
        ).length;
        const total = bills.filter((b) => b.groupId === group.id).length;
        return (
          <button
            className={`group-card ${group.color}`}
            key={group.id}
            onClick={() => onGroup(group.id)}
          >
            <div className="group-card-top">
              <span className="group-symbol">
                <Icon name={group.icon} size={27} />
              </span>
              <span className="group-index">0{i + 1}</span>
              <Icon name="diagonal" className="group-arrow" size={18} />
            </div>
            <h3>{group.name}</h3>
            <p className="group-description">{group.description}</p>
            <div className="group-card-bottom">
              <Avatars names={group.members} />
              <span>
                {pending ? (
                  <>
                    <i className="status-dot" />
                    {pending} to confirm
                  </>
                ) : (
                  `${total} ${total === 1 ? "bill" : "bills"} shared`
                )}
              </span>
            </div>
          </button>
        );
      })}
      {onCreate && (
        <button className="create-group-card" onClick={onCreate}>
          <Icon name="plus" />
          <span>A new group, a new plan</span>
        </button>
      )}
    </div>
  );
}
export function BillList({
  bills,
  groups,
  onBill,
  compact = false,
}: {
  bills: Bill[];
  groups: Group[];
  onBill: (bill: Bill) => void;
  compact?: boolean;
}) {
  if (!bills.length)
    return (
      <div className="empty-state">
        <Icon name="check" size={30} />
        <h3>All clear here.</h3>
        <p>No bills in this view. Enjoy the breathing room.</p>
      </div>
    );
  return (
    <div className={`bill-list ${compact ? "compact" : ""}`}>
      {bills.map((bill) => {
        const group = groups.find((g) => g.id === bill.groupId)!;
        return (
          <button
            className="bill-row"
            key={bill.id}
            onClick={() => onBill(bill)}
          >
            <span className={`bill-symbol ${group.color}`}>
              <Icon name={group.icon} />
            </span>
            <span className="bill-title">
              <strong>{bill.title}</strong>
              <span>
                {group.name}
                <span className="bill-date"> · {shortDate(bill.date)}</span>
              </span>
            </span>
            <span className={`bill-status ${bill.status}`}>
              {bill.status === "pending"
                ? "Awaiting shares"
                : bill.status === "complete"
                  ? "Complete"
                  : "Settled"}
            </span>
            <span className="bill-amount">
              <strong>{money(bill.total)}</strong>
              <span>
                {bill.initiator === "Simon"
                  ? "You paid"
                  : `${bill.initiator} paid`}
              </span>
            </span>
            <Icon name="arrow" size={16} className="row-arrow" />
          </button>
        );
      })}
    </div>
  );
}
export function ActivityFeed({
  items,
  full = false,
}: {
  items: Activity[];
  full?: boolean;
}) {
  return (
    <div className={`activity-feed ${full ? "full" : ""}`}>
      {items.slice(0, full ? 30 : 3).map((item) => (
        <div className="activity-item" key={item.id}>
          <Avatar name={item.person} small />
          <div>
            <p>
              <strong>{item.person === "Simon" ? "You" : item.person}</strong>{" "}
              {item.text}
            </p>
            <span>{item.detail}</span>
            <time>{shortDate(item.date)}</time>
          </div>
        </div>
      ))}
    </div>
  );
}

import { useId, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { money } from "./bill-api";

export type ReceiptItemRowProps = {
  item: { id: string; name: string; quantity: string; finalCents: number | null; taxable?: boolean | null; manualFinal?: boolean | null };
  mode: "review" | "claim" | "correction";
  onOpen: () => void;
  selected?: boolean;
  disabled?: boolean;
  /** Non-interactive badges and secondary content, e.g. future claim avatars. */
  badges?: ReactNode;
  secondary?: ReactNode;
  /** Separate actions, never nested inside the row button. */
  actions?: ReactNode;
  accessibleLabel?: string;
  /** Show the Azure line price rather than provisional allocated cost. */
  printedCents?: number | null;
};

export function ReceiptItemRow({ item, mode, onOpen, selected, disabled, badges, secondary, actions, accessibleLabel, printedCents }: ReceiptItemRowProps) {
  const detailId = useId();
  const displayCents = printedCents === undefined ? item.finalCents : printedCents;
  return <div className={`receipt-compact-row receipt-row-${mode}${selected ? " is-selected" : ""}`} data-item-id={item.id}>
    <button type="button" className="receipt-row-open" onClick={onOpen} disabled={disabled}
      aria-label={accessibleLabel ?? `${mode === "claim" ? "View" : "Edit"} ${item.name || "Unnamed item"}`} aria-haspopup="dialog" aria-describedby={detailId}>
      <span id={detailId} className="sr-only">Quantity {item.quantity || "1"}. {printedCents !== undefined ? "Printed price" : "Final cost"} {displayCents === null ? "missing" : money(displayCents)}.{printedCents === undefined && item.manualFinal ? " Manual override." : ""}{printedCents === undefined && item.taxable === false ? " No tax." : ""}</span>
      <span className="receipt-row-copy">
        <span className="receipt-row-name"><strong>{item.name || "Unnamed item"}</strong><span className="receipt-row-quantity">×{item.quantity || "1"}</span></span>
        <span className="receipt-row-badges">
          {printedCents === undefined && item.manualFinal && <span className="receipt-badge">Manual override</span>}
          {printedCents === undefined && item.taxable === false && <span className="receipt-badge">No tax</span>}
          {printedCents === undefined && item.finalCents === null && <span className="receipt-badge receipt-badge-warning">Missing cost</span>}
          {badges}
        </span>
        {secondary && <span className="receipt-row-secondary">{secondary}</span>}
      </span>
      <span className="receipt-row-cost">{printedCents !== undefined && <small>printed</small>}{displayCents === null ? "—" : money(displayCents)}<ChevronRight size={16} aria-hidden="true" /></span>
    </button>
    {actions && <div className="receipt-row-actions">{actions}</div>}
  </div>;
}

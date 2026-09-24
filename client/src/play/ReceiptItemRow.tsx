import { useId, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { money } from "./bill-api";

export type ReceiptItemRowProps = {
  item: { id: string; name: string; quantity: string; finalCents: number | null; taxable?: boolean | null; manualFinal?: boolean };
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
};

export function ReceiptItemRow({ item, mode, onOpen, selected, disabled, badges, secondary, actions, accessibleLabel }: ReceiptItemRowProps) {
  const detailId = useId();
  return <div className={`receipt-compact-row receipt-row-${mode}${selected ? " is-selected" : ""}`} data-item-id={item.id}>
    <button type="button" className="receipt-row-open" onClick={onOpen} disabled={disabled}
      aria-label={accessibleLabel ?? `${mode === "claim" ? "View" : "Edit"} ${item.name || "Unnamed item"}`} aria-haspopup="dialog" aria-describedby={detailId}>
      <span id={detailId} className="sr-only">Quantity {item.quantity || "1"}. Final cost {item.finalCents === null ? "missing" : money(item.finalCents)}.{item.manualFinal ? " Manual override." : ""}{item.taxable === false ? " No tax." : ""}</span>
      <span className="receipt-row-copy">
        <span className="receipt-row-name"><strong>{item.name || "Unnamed item"}</strong><span className="receipt-row-quantity">×{item.quantity || "1"}</span></span>
        <span className="receipt-row-badges">
          {item.manualFinal && <span className="receipt-badge">Manual override</span>}
          {item.taxable === false && <span className="receipt-badge">No tax</span>}
          {item.finalCents === null && <span className="receipt-badge receipt-badge-warning">Missing cost</span>}
          {badges}
        </span>
        {secondary && <span className="receipt-row-secondary">{secondary}</span>}
      </span>
      <span className="receipt-row-cost">{item.finalCents === null ? "—" : money(item.finalCents)}<ChevronRight size={16} aria-hidden="true" /></span>
    </button>
    {actions && <div className="receipt-row-actions">{actions}</div>}
  </div>;
}

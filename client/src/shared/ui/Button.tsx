import { type ReactNode } from "react";

export function Button({
  children,
  onClick,
  variant = "primary",
  className = "",
  type = "button",
  disabled = false,
  describedBy,
  expanded,
  controls,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "text";
  className?: string;
  type?: "button" | "submit";
  disabled?: boolean;
  /** Ids of elements that explain the action, such as the row a short label belongs to. */
  describedBy?: string;
  /** For a disclosure: whether the content it shows is visible, and that content's id. */
  expanded?: boolean;
  controls?: string;
}) {
  return (
    <button
      type={type}
      className={`button ${variant} ${className}`}
      onClick={onClick}
      disabled={disabled}
      aria-describedby={describedBy}
      aria-expanded={expanded}
      aria-controls={controls}
    >
      {children}
    </button>
  );
}

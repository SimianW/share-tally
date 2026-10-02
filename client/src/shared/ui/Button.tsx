import { type ReactNode } from "react";

export function Button({
  children,
  onClick,
  variant = "primary",
  className = "",
  type = "button",
  disabled = false,
  describedBy,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "text";
  className?: string;
  type?: "button" | "submit";
  disabled?: boolean;
  /** Ids of elements that explain the action, such as the row a short label belongs to. */
  describedBy?: string;
}) {
  return (
    <button
      type={type}
      className={`button ${variant} ${className}`}
      onClick={onClick}
      disabled={disabled}
      aria-describedby={describedBy}
    >
      {children}
    </button>
  );
}

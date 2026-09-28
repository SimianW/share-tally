import { useId, type ReactNode } from "react";
import { motion, type Transition } from "motion/react";
import "./segmented-control.css";

export type SegmentedOption<Value extends string> = {
  value: Value;
  content: ReactNode;
  /** Accessible name when the visible content does not say enough, such as a price. */
  label?: string;
  disabled?: boolean;
};

// Close to a native segmented control: settles in about a quarter second with
// a slight overshoot. MotionConfig at the app root turns it off for reduced motion.
const slide: Transition = { type: "spring", visualDuration: 0.25, bounce: 0.15 };

/**
 * One choice from a row of segments, built on native radios so the browser
 * provides arrow keys, disabled skipping and radio semantics. A `null` value
 * selects nothing and hides the indicator.
 */
export function SegmentedControl<Value extends string>({
  label,
  labelledBy,
  options,
  value,
  onChange,
  className,
}: {
  label?: string;
  labelledBy?: string;
  options: readonly SegmentedOption<Value>[];
  value: Value | null;
  onChange: (value: Value) => void;
  className?: string;
}) {
  // The indicator's layout id must be unique per control, or two controls on
  // one screen would animate into each other.
  const id = useId();
  return (
    <div
      role="radiogroup"
      aria-label={label}
      aria-labelledby={labelledBy}
      className={className ? `segmented ${className}` : "segmented"}
    >
      {options.map((option) => {
        const checked = option.value === value;
        return (
          <label key={option.value} className="segmented-option">
            <input
              type="radio"
              name={id}
              value={option.value}
              checked={checked}
              disabled={option.disabled}
              aria-label={option.label}
              onChange={() => onChange(option.value)}
            />
            {checked && (
              <motion.span
                layoutId={`${id}-indicator`}
                // Only a new choice moves the indicator. Without this it would also
                // animate whenever content above pushes the whole control.
                layoutDependency={value}
                className="segmented-indicator"
                // Set here rather than in CSS so Motion corrects the radius while it scales.
                style={{ borderRadius: 999 }}
                transition={slide}
                aria-hidden="true"
              />
            )}
            <span className="segmented-content">{option.content}</span>
          </label>
        );
      })}
    </div>
  );
}

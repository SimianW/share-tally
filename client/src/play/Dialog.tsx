import { useEffect, useId, useRef, type MouseEvent, type ReactNode, type RefObject } from "react";
import { Icon } from "./ui";

let openDialogs = 0;
let restorePageScroll: (() => void) | undefined;
function lockPageScroll() {
  if (openDialogs++ === 0) {
    const body = document.body;
    const root = document.documentElement;
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    const previousBody = {
      overflow: body.style.overflow,
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      width: body.style.width,
    };
    const rootOverflow = root.style.overflow;
    root.style.overflow = "hidden";
    Object.assign(body.style, {
      overflow: "hidden",
      position: "fixed",
      top: `-${scrollY}px`,
      left: `-${scrollX}px`,
      width: "100%",
    });
    restorePageScroll = () => {
      Object.assign(body.style, previousBody);
      root.style.overflow = rootOverflow;
      window.scrollTo({ left: scrollX, top: scrollY, behavior: "instant" });
    };
  }
  return () => {
    if (--openDialogs === 0) {
      restorePageScroll?.();
      restorePageScroll = undefined;
    }
  };
}

function outside(event: MouseEvent<HTMLDialogElement>) {
  if (event.target !== event.currentTarget) return false;
  const box = event.currentTarget.getBoundingClientRect();
  return event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom;
}

export default function Dialog({
  title,
  children,
  close,
  kicker = "A LITTLE LESS MATH",
  className = "",
  closeLabel = "Close dialog",
  headingRef,
  actions,
  closeOnOutsideClick = false,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
  kicker?: string;
  className?: string;
  closeLabel?: string;
  // Makes the heading focusable, so it can take focus instead of a field.
  headingRef?: RefObject<HTMLHeadingElement | null>;
  // Extra header controls, placed before the close button.
  actions?: ReactNode;
  // Closes on a tap outside the dialog, as a bottom sheet should.
  closeOnOutsideClick?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const pressedOutside = useRef(false);
  const id = useId();
  useEffect(() => {
    const dialog = ref.current!;
    const previous = document.activeElement;
    dialog.showModal();
    // A heading made focusable by headingRef is the fallback when no field has data-autofocus.
    (dialog.querySelector<HTMLElement>("[data-autofocus]") ?? dialog.querySelector<HTMLElement>("h2[tabindex]"))?.focus();
    // Nested discard/delete confirmations share one page scroll lock.
    const unlock = lockPageScroll();
    return () => {
      dialog.close();
      unlock();
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`play-dialog ${className}`}
      aria-labelledby={id}
      // Backdrop taps reach the dialog itself, as do taps on its padding, so only a
      // press that both starts and ends outside the dialog's box closes it.
      onPointerDown={(event) => { pressedOutside.current = closeOnOutsideClick && outside(event); }}
      onClick={(event) => {
        if (pressedOutside.current && outside(event)) close();
        pressedOutside.current = false;
      }}
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        close();
      }}
    >
      <div className="dialog-heading">
        <div>
          <div className="eyebrow">{kicker}</div>
          <h2 id={id} ref={headingRef} tabIndex={headingRef ? -1 : undefined}>{title}</h2>
        </div>
        <div className="dialog-heading-actions">
          {actions}
          <button
            type="button"
            className="icon-button"
            aria-label={closeLabel}
            onClick={close}
          >
            <Icon name="close" />
          </button>
        </div>
      </div>
      {children}
    </dialog>
  );
}

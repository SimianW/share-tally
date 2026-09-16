import { useEffect, useId, useRef, type ReactNode } from "react";
import { Icon } from "./ui";

export default function Dialog({
  title,
  children,
  close,
  kicker = "A LITTLE LESS MATH",
  className = "",
}: {
  title: string;
  children: ReactNode;
  close: () => void;
  kicker?: string;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const dialog = ref.current!;
    const previous = document.activeElement;
    dialog.showModal();
    dialog.querySelector<HTMLElement>("[data-autofocus]")?.focus();
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
    // Mobile Safari can still pan the page behind a modal with overflow alone.
    root.style.overflow = "hidden";
    Object.assign(body.style, {
      overflow: "hidden",
      position: "fixed",
      top: `-${scrollY}px`,
      left: `-${scrollX}px`,
      width: "100%",
    });
    return () => {
      dialog.close();
      Object.assign(body.style, previousBody);
      root.style.overflow = rootOverflow;
      window.scrollTo({ left: scrollX, top: scrollY, behavior: "instant" });
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`play-dialog ${className}`}
      aria-labelledby={id}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        if (
          e.target === e.currentTarget &&
          (e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom)
        )
          close();
      }}
    >
      <div className="dialog-heading">
        <div>
          <div className="eyebrow">{kicker}</div>
          <h2 id={id}>{title}</h2>
        </div>
        <button
          className="icon-button"
          aria-label="Close dialog"
          onClick={close}
        >
          <Icon name="close" />
        </button>
      </div>
      {children}
    </dialog>
  );
}

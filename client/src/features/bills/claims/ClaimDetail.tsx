import { useId, type ComponentProps } from "react";
import Dialog from "../../../shared/ui/Dialog";
import { Icon } from "../../../shared/ui/Icon";

/** The same item details live in a modal sheet on mobile and a named region on desktop. */
export function ClaimDetail({ desktop, headingRef, ...props }: ComponentProps<typeof Dialog> & { desktop: boolean }) {
  const id = useId();
  if (!desktop) return <Dialog headingRef={headingRef} {...props} />;
  return <section className="receipt-sheet claim-sheet claim-detail" aria-labelledby={id}>
    <div className="dialog-heading">
      <div><div className="eyebrow">{props.kicker}</div>
        <h2 id={id} ref={headingRef} tabIndex={-1}>{props.title}</h2></div>
      <div className="dialog-heading-actions">{props.actions}
        <button type="button" className="icon-button" aria-label={props.closeLabel} onClick={props.close}><Icon name="close" /></button>
      </div>
    </div>
    {props.children}
  </section>;
}

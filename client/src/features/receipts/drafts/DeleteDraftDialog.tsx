

import Dialog from "../../../shared/ui/Dialog";
import { Button } from "../../../shared/ui/Button";

export function DeleteDraftDialog({
  title,
  busy,
  cancel,
  remove,
}: {
  title: string;
  busy: boolean;
  cancel: () => void;
  remove: () => void;
}) {
  return (
    <Dialog
      title="Delete this draft?"
      kicker="PRIVATE DRAFT"
      close={() => {
        if (!busy) cancel();
      }}
    >
      <p>
        <strong>{title || "Untitled bill"}</strong>
      </p>
      <p>
        This deletes the draft and any attached receipt photo. Group bills and
        balances will not change. This cannot be undone.
      </p>
      <div className="dialog-actions">
        <Button variant="secondary" disabled={busy} onClick={cancel}>
          Keep draft
        </Button>
        <Button className="draft-danger" disabled={busy} onClick={remove}>
          {busy ? "Deleting…" : "Delete draft"}
        </Button>
      </div>
    </Dialog>
  );
}

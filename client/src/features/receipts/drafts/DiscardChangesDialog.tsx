import { Button } from "../../../shared/ui/Button";
import Dialog from "../../../shared/ui/Dialog";

export function DiscardChangesDialog({ saved, keepEditing, discard }: {
  /** Whether a saved draft remains after discarding. */
  saved: boolean;
  keepEditing: () => void;
  discard: () => void;
}) {
  return (
    <Dialog title="Discard unsaved changes?" kicker="BEFORE YOU CLOSE" close={keepEditing}>
      <p>
        {saved
          ? "Only unsaved edits will be discarded. Your last saved draft, including its saved receipt scan and photo, will stay as it was."
          : "This bill has not been saved. Its unsaved details and receipt photo will be discarded."}
      </p>
      <div className="dialog-actions">
        <Button variant="secondary" onClick={keepEditing}>
          Keep editing
        </Button>
        <Button className="draft-danger" onClick={discard}>
          Discard changes
        </Button>
      </div>
    </Dialog>
  );
}

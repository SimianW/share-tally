import { DeleteDraftDialog } from './DeleteDraftDialog';
import { clearDeletedDraft } from './draft-recovery';
import { useCallback, useState } from "react";
import { useReceiptDraftSync } from "./receipt-draft-sync";
import { money } from "../../../shared/money";
import { errorMessage } from "../../../shared/api/error-message";
import { useReceiptApi } from "../api";
import { type ReceiptDraft } from "@share-tally/domain/contracts/receipts";
import { Button } from "../../../shared/ui/Button";
import { ArrowRight, FilePenLine, LockKeyhole, Trash2 } from "lucide-react";

export function ReceiptDrafts({
  groupId,
  open,
}: {
  groupId: string;
  open: (id: string) => void;
}) {
  const api = useReceiptApi();
  const [drafts, setDrafts] = useState<ReceiptDraft[]>([]);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [deleting, setDeleting] = useState<ReceiptDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const applyDrafts = useCallback((updated: ReceiptDraft[]) => {
    setDrafts(updated);
    setError("");
  }, []);
  useReceiptDraftSync(groupId, null, applyDrafts, setError, true, retry);
  return (
    <section className="receipt-drafts">
      {drafts.length > 0 && (
        <>
          <h3>
            Your drafts <small>{drafts.length}</small>
          </h3>
          <p className="draft-private">
            <LockKeyhole size={14} /> Only you can see these. They do not affect
            group balances.
          </p>
        </>
      )}
      {drafts.map((d) => (
        <div className="draft-list-row" key={d.id}>
          <FilePenLine className="draft-list-icon" size={24} />
          <div className="draft-list-copy">
            <strong>{d.data.title || "Untitled bill"}</strong>
            <small>
              {d.data.mode === "items" ? "Split by items" : "Split by amount"}
              {d.processingStatus === "processing" && <span className="draft-processing-status"> · Checking names & tax…</span>}
              {d.processingStatus === "fallback" && " · Tax not checked"}
              {d.updatedAt &&
                ` · Saved ${new Date(d.updatedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`}
            </small>
          </div>
          <span className="draft-list-total">
            {d.data.totalCents === null
              ? "Total not entered"
              : money(d.data.totalCents)}
          </span>
          <Button variant="secondary" className="small" onClick={() => open(d.id)}>
            Continue <ArrowRight size={16} />
          </Button>
          <button
            className="draft-delete"
            aria-label={`Delete ${d.data.title || "untitled bill"}`}
            disabled={d.processingStatus === "processing"}
            onClick={() => {
              setError("");
              setDeleting(d);
            }}
          >
            <Trash2 size={18} />
          </button>
        </div>
      ))}
      {deleting && (
        <DeleteDraftDialog
          title={deleting.data.title}
          busy={busy}
          cancel={() => setDeleting(null)}
          remove={() => {
            setBusy(true);
            setError("");
            void api
              .remove(deleting.id, deleting.revision)
              .then(() => {
                clearDeletedDraft(deleting.id);
                setDrafts((ds) => ds.filter((d) => d.id !== deleting.id));
                setDeleting(null);
              })
              .catch((e) => {
                setError(errorMessage(e));
                setDeleting(null);
                setRetry((n) => n + 1);
              })
              .finally(() => setBusy(false));
          }}
        />
      )}
      {error && (
        <p role="alert">
          {error}{" "}
          <Button onClick={() => setRetry((n) => n + 1)}>Retry drafts</Button>
        </p>
      )}
    </section>
  );
}

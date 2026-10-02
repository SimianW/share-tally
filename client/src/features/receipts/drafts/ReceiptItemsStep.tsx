import { type ReceiptData, type ReceiptDraft } from "@share-tally/domain/contracts/receipts";
import { Upload } from "lucide-react";
import { Button } from "../../../shared/ui/Button";
import { Notification } from "../../../shared/ui/Notification";
import { ReceiptPhoto } from "../photos/ReceiptPhoto";
import { ReceiptReviewItems } from "../review/ReceiptReview";
import { ScanActions } from "./ScanActions";

export function ReceiptItemsStep({
  draft, unassignedTaxMessage, replace, setReplace, scan, update, confirmItem, openReceipt,
}: {
  draft: ReceiptDraft;
  unassignedTaxMessage: string | null;
  replace: boolean;
  setReplace: (value: boolean) => void;
  scan: () => void;
  update: (patch: Partial<ReceiptData>) => void;
  confirmItem: (itemId: string, flag: "needsCheck" | "taxNotChecked") => Promise<boolean>;
  openReceipt: () => void;
}) {
  const data = draft.data;
  const processing = draft.processingStatus === "processing";
  return (
    <div className={`receipt-review-layout${draft.photo ? "" : " receipt-without-photo"}`}>
      <div className="receipt-photo-panel">
        {draft.photo && (
          <ReceiptPhoto
            id={draft.id}
            version={draft.revision}
            localPhoto={draft.pendingPhoto}
            expired={draft.photo.expired}
            review
          />
        )}

        <Button variant="secondary" disabled={processing} onClick={openReceipt}>
          <Upload size={18} aria-hidden="true" />
          {draft.photo
            ? "Replace receipt photo"
            : "Use a receipt photo"}
        </Button>
      </div>
      <div>
        {draft.photo && !draft.photo.expired && (
          <ScanActions hasItems={data.items.length > 0} replace={replace} setReplace={setReplace} scan={scan} disabled={processing} />
        )}
        {unassignedTaxMessage && !processing && (
          <Notification tone="error" title="Receipt tax needs an item">
            {unassignedTaxMessage}
          </Notification>
        )}
        <ReceiptReviewItems
          items={data.items}
          change={(items) => update({ items })}
          processing={processing}
          processingStatus={draft.processingStatus}
          scanned={!!draft.photo && data.items.length > 0}
          onConfirm={confirmItem}
          photo={draft.photo && !draft.photo.expired && !draft.pendingPhoto
            ? { id: draft.id, version: draft.revision, pages: data.receipt?.evidence?.pages }
            : undefined}
        />
      </div>
    </div>
  );
}

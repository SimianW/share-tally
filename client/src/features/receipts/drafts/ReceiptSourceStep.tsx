import {
  type ReceiptData,
  type ReceiptDraft,
} from "@share-tally/domain/contracts/receipts";
import { Camera, PencilLine, ReceiptText, Upload } from "lucide-react";
import { useRef } from "react";
import { Button } from "../../../shared/ui/Button";
import { ReceiptPhoto } from "../photos/ReceiptPhoto";
import { ScanActions } from "./ScanActions";

export function ReceiptSourceStep({
  draft,
  setFile,
  replace,
  setReplace,
  scan,
  update,
  setStep,
}: {
  draft: ReceiptDraft;
  setFile: (file: File | null) => void;
  replace: boolean;
  setReplace: (value: boolean) => void;
  scan: () => void;
  update: (patch: Partial<ReceiptData>) => void;
  setStep: (step: number) => void;
}) {
  const data = draft.data;
  const cameraInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  return (
    <>
      <div className="receipt-source">
        <ReceiptText size={32} aria-hidden="true" />
        <h4>{draft.photo ? "Your receipt" : "Bring in your shopping list"}</h4>
        <p>Choose an image, crop it, then read the receipt.</p>
        <div
          className="receipt-upload"
          role="group"
          aria-label="Add a receipt photo"
        >
          <input
            ref={cameraInput}
            hidden
            type="file"
            aria-label="Take a receipt photo"
            accept="image/jpeg,image/png,image/webp"
            capture="environment"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              e.currentTarget.value = "";
            }}
          />
          <input
            ref={fileInput}
            hidden
            type="file"
            aria-label="Choose a receipt image"
            accept="image/jpeg,image/png,image/webp"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              e.currentTarget.value = "";
            }}
          />
          <Button
            variant="secondary"
            className="receipt-camera-button"
            onClick={() => cameraInput.current?.click()}
          >
            <Camera size={20} strokeWidth={1.8} aria-hidden="true" />
            Take a picture
          </Button>
          <Button
            variant="secondary"
            onClick={() => fileInput.current?.click()}
          >
            <Upload size={20} strokeWidth={1.8} aria-hidden="true" />
            Choose file
          </Button>
        </div>
        {draft.photo && (
          <ReceiptPhoto
            id={draft.id}
            version={draft.revision}
            localPhoto={draft.pendingPhoto}
            expired={draft.photo.expired}
          />
        )}
        {draft.photo && !draft.photo.expired && (
          <ScanActions
            hasItems={data.items.length > 0}
            replace={replace}
            setReplace={setReplace}
            scan={scan}
          />
        )}
      </div>
      <div className="receipt-entry-alternative">
        <span>or</span>
        <Button
          variant="secondary"
          onClick={() => {
            update({ mode: "items" });
            setStep(1);
          }}
        >
          <PencilLine size={18} aria-hidden="true" /> Enter items myself
        </Button>
        <Button
          variant="text"
          onClick={() => {
            update({ mode: "manual" });
            setStep(2);
          }}
        >
          Split by amount instead
        </Button>
      </div>
    </>
  );
}

import {
  type ReceiptData,
  type ReceiptDraft,
} from "@share-tally/domain/contracts/receipts";
import { Camera, Divide, ListChecks, PencilLine, ReceiptText, Upload } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useRef, useState } from "react";
import { amountText } from "../../../shared/money";
import { Button } from "../../../shared/ui/Button";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { ReceiptPhoto } from "../photos/ReceiptPhoto";
import { type Step } from "./draft-model";
import { ScanActions } from "./ScanActions";
import { SplitTotalPanel } from "./SplitTotalPanel";

type Mode = ReceiptData["mode"];

/**
 * The first step chooses how the bill is split. The switch is view state only:
 * the draft's mode changes when the initiator types a total, continues, types
 * items or scans.
 */
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
  setStep: (step: Step) => void;
}) {
  const [mode, setMode] = useState<Mode>(draft.data.mode);
  // Held here so a typed total survives a look at the other panel.
  const [totalText, setTotalText] = useState(() =>
    draft.data.mode === "manual" && draft.data.totalCents !== null ? amountText(draft.data.totalCents) : "");
  const reducedMotion = useReducedMotion();
  return (
    <div className="split-method">
      <SegmentedControl
        label="How to split this bill"
        className="split-method-switch"
        value={mode}
        onChange={setMode}
        options={[
          { value: "items", content: <><ListChecks aria-hidden="true" /> By item</> },
          { value: "manual", content: <><Divide aria-hidden="true" /> By amount</> },
        ]}
      />
      {/* Each panel enters from the side of the option that shows it. */}
      <motion.div
        key={mode}
        className="split-method-panel"
        initial={reducedMotion ? false : { opacity: 0, x: mode === "items" ? -14 : 14 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.28, ease: [0.2, 0.8, 0.3, 1] }}
      >
        {mode === "items" ? (
          <ItemSource draft={draft} setFile={setFile} replace={replace} setReplace={setReplace}
            scan={scan} update={update} setStep={setStep} />
        ) : (
          <SplitTotalPanel mode={draft.data.mode} text={totalText} setText={setTotalText} update={update} setStep={setStep} />
        )}
      </motion.div>
    </div>
  );
}

function ItemSource({
  draft,
  setFile,
  replace,
  setReplace,
  scan,
  update,
  setStep,
}: Parameters<typeof ReceiptSourceStep>[0]) {
  const data = draft.data;
  const cameraInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const choose = (input: HTMLInputElement) => {
    setFile(input.files?.[0] ?? null);
    input.value = "";
  };
  return (
    <section aria-label="Split by item">
      <p className="split-method-outcome">
        Everyone claims what they had and pays for their own items.
      </p>
      <div className="receipt-source">
        <ReceiptText className="receipt-source-icon" size={28} strokeWidth={1.8} aria-hidden="true" />
        <div>
          <h4>{draft.photo ? "Your receipt" : "Scan a receipt"}</h4>
          <p>Take or choose a photo, crop it, and the items are read for you.</p>
        </div>
        <div className="receipt-upload" role="group" aria-label="Add a receipt photo">
          <input
            ref={cameraInput}
            hidden
            type="file"
            aria-label="Take a receipt photo"
            accept="image/jpeg,image/png,image/webp"
            capture="environment"
            onChange={(e) => choose(e.currentTarget)}
          />
          <input
            ref={fileInput}
            hidden
            type="file"
            aria-label="Choose a receipt image"
            accept="image/jpeg,image/png,image/webp"
            onChange={(e) => choose(e.currentTarget)}
          />
          <Button className="receipt-camera-button" onClick={() => cameraInput.current?.click()}>
            <Camera size={20} strokeWidth={1.8} aria-hidden="true" />
            Take a picture
          </Button>
          <Button variant="secondary" onClick={() => fileInput.current?.click()}>
            <Upload size={20} strokeWidth={1.8} aria-hidden="true" />
            Choose a photo
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
      <p className="receipt-entry-alternative">
        No receipt to hand?
        <Button
          variant="text"
          onClick={() => {
            update({ mode: "items" });
            setStep(1);
          }}
        >
          <PencilLine size={17} aria-hidden="true" /> Type the items in
        </Button>
      </p>
    </section>
  );
}

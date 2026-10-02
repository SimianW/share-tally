import { type ReceiptData } from "@share-tally/domain/contracts/receipts";
import {
  ArrowRight,
  CircleDollarSign,
  ListChecks,
  PencilLine,
} from "lucide-react";
import { localToday } from "../../../shared/browser/date";
import { money } from "../../../shared/money";
import { Button } from "../../../shared/ui/Button";
import { MoneyField } from "../../../shared/ui/fields/MoneyField";
import { ParticipantPicker } from "../../../shared/ui/ParticipantPicker";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { type GroupDetail } from "../../groups/api";
import { itemsComplete, itemsReady } from "./draft-model";

export function ReceiptSharingStep({
  data,
  group,
  ownId,
  update,
  setStep,
  notesOpen,
  setNotesOpen,
  enteringTotal,
  setEnteringTotal,
  splitLegendId,
}: {
  data: ReceiptData;
  group: GroupDetail;
  ownId: string;
  update: (patch: Partial<ReceiptData>) => void;
  setStep: (step: number) => void;
  notesOpen: boolean;
  setNotesOpen: (value: boolean) => void;
  enteringTotal: boolean;
  setEnteringTotal: (value: boolean) => void;
  splitLegendId: string;
}) {
  const itemTotal = data.items.reduce(
    (sum, item) => sum + (item.finalCents ?? 0),
    0,
  );
  const paidCents =
    data.mode === "items" ? (data.totalCents ?? itemTotal) : data.totalCents;
  const canSplitByItem = itemsReady({ ...data, mode: "items" });
  const missing = [
    !data.title.trim() && "a bill title",
    !(paidCents !== null && paidCents > 0) && "the total paid",
    data.mode === "items" && !itemsComplete(data) && "item names and prices",
  ].filter(Boolean);
  return (
    <div className="receipt-sharing">
      <div className="sharing-details">
        <label>
          Bill title
          <input
            required
            maxLength={120}
            value={data.title}
            onChange={(e) => update({ title: e.target.value })}
          />
        </label>
        <label>
          Purchase date
          <input
            required
            type="date"
            max={localToday()}
            value={data.purchaseDate}
            onChange={(e) => update({ purchaseDate: e.target.value })}
          />
        </label>
      </div>
      <ParticipantPicker
        members={group.members}
        selected={data.participantIds}
        lockedId={ownId}
        change={(participantIds) => update({ participantIds })}
        shortcuts
      />
      <fieldset className="sharing-split">
        <legend id={splitLegendId} className="sharing-section-title">
          Split
        </legend>
        <SegmentedControl
          labelledBy={splitLegendId}
          value={data.mode}
          onChange={(mode) => {
            setEnteringTotal(false);
            update({ mode });
          }}
          options={[
            {
              value: "items",
              content: (
                <>
                  <ListChecks aria-hidden="true" /> By item
                </>
              ),
              disabled: data.mode !== "items" && !canSplitByItem,
            },
            {
              value: "manual",
              content: (
                <>
                  <CircleDollarSign aria-hidden="true" /> By amount
                </>
              ),
            },
          ]}
        />
        <p className="split-hint">
          {data.mode === "items"
            ? "Everyone picks the items they're in on."
            : "Everyone enters their own share."}
          {data.mode !== "items" && !canSplitByItem && (
            <span> Add items first to split by item.</span>
          )}
        </p>
        {(data.mode === "manual" ||
          data.totalCents !== null ||
          enteringTotal) && (
          <div className="split-amounts">
            <MoneyField
              label="Total paid (CAD)"
              value={data.totalCents}
              change={(totalCents) => update({ totalCents })}
              required={data.mode === "manual"}
              autoFocus={data.mode === "items" && enteringTotal}
            />
          </div>
        )}
        {data.mode === "items" && (
          <div className="split-items">
            {data.totalCents === null ? (
              <p>
                Total paid <strong>{money(itemTotal)}</strong> · from items
              </p>
            ) : (
              <p>
                {/* Claims round per person, so the final initiator adjustment
                            can differ from this draft-time difference by a few cents. */}
                Items add up to {money(itemTotal)}
                {data.totalCents !== null &&
                  data.totalCents > itemTotal &&
                  ` (${money(data.totalCents - itemTotal)} under the total paid)`}
                {data.totalCents !== null &&
                  data.totalCents < itemTotal &&
                  ` (${money(itemTotal - data.totalCents)} over the total paid)`}
                .
                {data.totalCents !== null &&
                  data.totalCents !== itemTotal &&
                  " Any difference left after everyone claims goes to you."}
              </p>
            )}
            <div className="split-items-actions">
              {/* One button swaps its action, so focus stays put when the input goes away. */}
              <Button
                variant="text"
                onClick={() => {
                  if (data.totalCents === null && !enteringTotal) {
                    setEnteringTotal(true);
                    return;
                  }
                  setEnteringTotal(false);
                  update({ totalCents: null });
                }}
              >
                {data.totalCents === null && !enteringTotal
                  ? "Paid a different amount?"
                  : "Use item total"}
              </Button>
              <Button variant="text" onClick={() => setStep(1)}>
                Edit {data.items.length}{" "}
                {data.items.length === 1 ? "item" : "items"}{" "}
                <ArrowRight size={16} aria-hidden="true" />
              </Button>
            </div>
          </div>
        )}
      </fieldset>
      {notesOpen || data.notes ? (
        <label>
          Notes
          <textarea
            maxLength={2000}
            autoFocus={notesOpen && !data.notes}
            value={data.notes}
            onChange={(e) => update({ notes: e.target.value })}
          />
        </label>
      ) : (
        <Button
          variant="text"
          className="sharing-add-note"
          onClick={() => setNotesOpen(true)}
        >
          <PencilLine size={16} aria-hidden="true" /> Add a note
        </Button>
      )}
      {missing.length > 0 && (
        <p className="field-error">
          Add{" "}
          {missing.length > 1
            ? `${missing.slice(0, -1).join(", ")} and ${missing.at(-1)}`
            : missing[0]}
          .
        </p>
      )}
    </div>
  );
}

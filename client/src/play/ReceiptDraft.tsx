import { requestId } from "./request-id";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { BillApiError, localToday, money, type Bill } from "./bill-api";
import { errorMessage, type GroupDetail } from "./group-api";
import {
  useReceiptApi,
  type ReceiptDraft,
  type ReceiptData,
} from "./receipt-api";
import { ReceiptItemEditor, ReceiptAmount } from "./ReceiptItemEditor";
import { ReceiptCrop, ReceiptPhoto } from "./ReceiptPhoto";
import Dialog from "./Dialog";
import { Button } from "./ui";
import { Camera, Upload } from "lucide-react";
import "./receipts.css";

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
  useEffect(() => {
    let live = true;
    api
      .list(groupId)
      .then((r) => {
        if (live) {
          setDrafts(r.drafts);
          setError("");
        }
      })
      .catch((e) => {
        if (live) setError(errorMessage(e));
      });
    return () => {
      live = false;
    };
  }, [api, groupId, retry]);
  return (
    <section className="receipt-drafts">
      {drafts.length > 0 && <h3>Your private drafts</h3>}
      {drafts.map((d) => (
        <Button key={d.id} variant="secondary" onClick={() => open(d.id)}>
          Continue {d.data.title || "untitled bill"}
        </Button>
      ))}
      {error && (
        <p role="alert">
          {error}{" "}
          <Button onClick={() => setRetry((n) => n + 1)}>Retry drafts</Button>
        </p>
      )}
    </section>
  );
}

const Prototype = import.meta.env.DEV
  ? lazy(() => import("./NewBill.prototype"))
  : null;

export function ReceiptDraftForm(props: {
  group: GroupDetail;
  id?: string;
  close: () => void;
  created: (bill: Bill) => void;
}) {
  if (Prototype && new URLSearchParams(location.search).has("variant"))
    return (
      <Suspense fallback={<p>Loading prototype…</p>}>
        <Prototype
          groupName={props.group.name}
          members={props.group.members.map((m) =>
            m.isCurrentUser ? "You" : m.displayName,
          )}
          close={props.close}
        />
      </Suspense>
    );
  return <LiveReceiptDraftForm {...props} />;
}

function LiveReceiptDraftForm({
  group,
  id,
  close,
  created,
}: {
  group: GroupDetail;
  id?: string;
  close: () => void;
  created: (bill: Bill) => void;
}) {
  const api = useReceiptApi();
  const me = group.members.find((m) => m.isCurrentUser)!;
  const createdRef = useRef(created);
  createdRef.current = created;
  const key = `receipt-draft:${me.id}:${group.id}:${id ?? "new"}`;
  const [draft, setDraft] = useState<ReceiptDraft>(() => {
    try {
      const stored = sessionStorage.getItem(key);
      if (stored) return JSON.parse(stored);
    } catch {
      /* Saved server draft remains available. */
    }
    return {
      id: id ?? requestId(),
      revision: 0,
      data: {
        mode: "items",
        title: "",
        purchaseDate: localToday(),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        notes: "",
        totalCents: null,
        ownShareCents: 0,
        participantIds: [me.id],
        items: [],
        receipt: {
          subtotalCents: null,
          taxCents: 0,
          discountCents: 0,
          extraCents: 0,
          pricesIncludeTax: false,
        },
      },
    };
  });
  const [loading, setLoading] = useState(!!id);
  const [busy, setBusy] = useState("");
  const [naming, setNaming] = useState(false);
  const [nameError, setNameError] = useState("");
  const cameraInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const pending = useRef(false);
  const ended = useRef(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [replace, setReplace] = useState(false);
  useEffect(() => {
    if (!id) return;
    let live = true;
    api
      .get(id)
      .then((r) => {
        if (live) {
          if (r.draft.billId) {
            void api
              .initialize(r.draft.id, r.draft.revision)
              .then((result) => createdRef.current(result.bill))
              .catch((e) => setError(errorMessage(e)));
          } else setDraft(r.draft);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (live) {
          setError(errorMessage(e));
          setLoading(false);
        }
      });
    return () => {
      live = false;
    };
  }, [api, id]);
  useEffect(() => {
    if (!loading && !ended.current)
      sessionStorage.setItem(key, JSON.stringify(draft));
  }, [draft, key, loading]);
  function clearLocal() {
    ended.current = true;
    sessionStorage.removeItem(key);
    const newKey = `receipt-draft:${me.id}:${group.id}:new`;
    try {
      const stored = JSON.parse(sessionStorage.getItem(newKey) ?? "null");
      if (stored?.id === draft.id) sessionStorage.removeItem(newKey);
    } catch {
      /* Ignore invalid local drafts. */
    }
  }
  function update(patch: Partial<ReceiptData>) {
    setDraft((d) => ({ ...d, data: { ...d.data, ...patch } }));
    setNotice("Unsaved changes");
  }
  async function run(label: string, action: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true;
    setBusy(label);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      pending.current = false;
      setBusy("");
    }
  }
  async function save(value = draft) {
    const { draft: saved } = await api.save(group.id, value);
    const next = { ...saved, photo: value.photo };
    setDraft(next);
    setNotice("Draft saved. Only you can see it.");
    return next;
  }
  async function scan() {
    const saved = await save();
    const { extraction } = await api.extract(saved.id, saved.revision);
    const next = await save({
      ...saved,
      data: {
        ...saved.data,
        items: extraction.items,
        receipt: extraction.receipt,
        totalCents: extraction.totalCents,
        title: saved.data.title || extraction.title,
      },
    });
    setWarnings(extraction.warnings);
    setReplace(false);
    void nameItems(next);
  }
  async function nameItems(snapshot: ReceiptDraft) {
    setNaming(true);
    setNameError("");
    try {
      const result = await api.names(snapshot.id, snapshot.revision);
      setDraft((current) => ({
        ...current,
        data: {
          ...current.data,
          items: current.data.items.map((item) => {
            const source = snapshot.data.items.find((i) => i.id === item.id);
            const name = result.names.find((n) => n.id === item.id)?.name;
            return source &&
              source.name === item.name &&
              source.originalText === item.originalText &&
              name
              ? { ...item, name }
              : item;
          }),
        },
      }));
    } catch (e) {
      setNameError(errorMessage(e));
    } finally {
      setNaming(false);
    }
  }
  const data = draft.data;
  const itemTotal = data.items.reduce((sum, i) => sum + (i.finalCents ?? 0), 0);
  const valid =
    data.totalCents !== null &&
    data.totalCents > 0 &&
    data.title.trim() &&
    (data.mode === "manual" ||
      (data.items.length > 0 &&
        data.items.every(
          (i) =>
            i.amountCents !== null &&
            i.finalCents !== null &&
            i.finalCents >= 0 &&
            i.name.trim(),
        )));
  return (
    <Dialog
      title="New bill"
      kicker={group.name}
      className="receipt-dialog"
      close={() => {
        if (draft.initializationRevision) {
          close();
          return;
        }
        if (!pending.current)
          void run("Saving draft…", async () => {
            await save();
            clearLocal();
            close();
          });
      }}
    >
      {loading ? (
        <p>Opening draft…</p>
      ) : (
        <form
          className="bill-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid)
              void run("Initiating…", async () => {
                const saved = draft.initializationRevision
                  ? draft
                  : await save();
                const revision = saved.initializationRevision ?? saved.revision;
                setDraft({ ...saved, initializationRevision: revision });
                try {
                  const result = await api.initialize(saved.id, revision);
                  clearLocal();
                  created(result.bill);
                } catch (e) {
                  if (e instanceof BillApiError && e.status < 500)
                    setDraft({ ...saved, initializationRevision: undefined });
                  throw e;
                }
              });
          }}
        >
          <fieldset disabled={!!busy || !!draft.initializationRevision}>
            <label>
              Allocation mode
              <select
                value={data.mode}
                onChange={(e) =>
                  update({
                    mode: e.target.value as ReceiptData["mode"],
                    ownShareCents: 0,
                  })
                }
              >
                <option value="items">Claim items</option>
                <option value="manual">Manual shares</option>
              </select>
            </label>
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
            <fieldset>
              <legend>Who shared this purchase?</legend>
              {group.members.map((m) => (
                <label className="participant-choice" key={m.id}>
                  <input
                    type="checkbox"
                    checked={data.participantIds.includes(m.id)}
                    disabled={m.isCurrentUser}
                    onChange={(e) =>
                      update({
                        participantIds: e.target.checked
                          ? [...data.participantIds, m.id]
                          : data.participantIds.filter((id) => id !== m.id),
                      })
                    }
                  />
                  {m.displayName}
                  {m.isCurrentUser ? " · You, initiator" : ""}
                </label>
              ))}
            </fieldset>
            {data.mode === "items" && (
              <>
                <div className="receipt-review-layout">
                  <div>
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
                        <Camera
                          size={20}
                          strokeWidth={1.8}
                          aria-hidden="true"
                        />
                        Take a picture
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => fileInput.current?.click()}
                      >
                        <Upload
                          size={20}
                          strokeWidth={1.8}
                          aria-hidden="true"
                        />
                        Choose file
                      </Button>
                    </div>
                    {file && (
                      <ReceiptCrop
                        key={`${file.name}:${file.lastModified}`}
                        file={file}
                        cancel={() => setFile(null)}
                        save={async (base64) => {
                          if (pending.current) return;
                          pending.current = true;
                          setBusy("Uploading…");
                          try {
                            const saved = await save();
                            const result = await api.upload(
                              saved.id,
                              saved.revision,
                              base64,
                            );
                            setDraft(result.draft);
                            setFile(null);
                          } finally {
                            pending.current = false;
                            setBusy("");
                          }
                        }}
                      />
                    )}
                    {draft.photo && (
                      <ReceiptPhoto
                        id={draft.id}
                        version={draft.revision}
                        expired={draft.photo.expired}
                      />
                    )}
                  </div>
                  <div>
                    {draft.photo && !draft.photo.expired && (
                      <>
                        {data.items.length > 0 && !replace ? (
                          <Button
                            variant="secondary"
                            onClick={() => setReplace(true)}
                          >
                            Scan and replace current items…
                          </Button>
                        ) : (
                          <Button
                            variant="secondary"
                            onClick={() => void run("Reading receipt…", scan)}
                          >
                            {replace
                              ? "Replace current items with a new scan"
                              : "Read receipt"}
                          </Button>
                        )}
                        {replace && (
                          <Button
                            variant="text"
                            onClick={() => setReplace(false)}
                          >
                            Keep current items
                          </Button>
                        )}
                      </>
                    )}
                    <ReceiptItemEditor
                      items={data.items}
                      change={(items) => update({ items })}
                      draftMode
                    />
                  </div>
                </div>
                {data.receipt && (
                  <fieldset>
                    <legend>Receipt adjustments</legend>
                    <label className="participant-choice">
                      <input
                        type="checkbox"
                        checked={data.receipt.pricesIncludeTax}
                        onChange={(e) => {
                          const next = {
                            ...draft,
                            data: {
                              ...data,
                              receipt: {
                                ...data.receipt!,
                                pricesIncludeTax: e.target.checked,
                              },
                            },
                          };
                          setDraft(next);
                          void run("Calculating…", async () => {
                            const saved = await save(next);
                            const result = await api.prices(
                              saved.id,
                              saved.revision,
                            );
                            setWarnings(result.warnings);
                            await save({
                              ...saved,
                              data: { ...saved.data, items: result.items },
                            });
                          });
                        }}
                      />
                      Printed prices include tax
                    </label>
                    {data.receipt.subtotalCents !== null && (
                      <p>
                        Printed subtotal: {money(data.receipt.subtotalCents)}
                      </p>
                    )}
                    <div className="receipt-costs">
                      {(
                        ["taxCents", "discountCents", "extraCents"] as const
                      ).map((field, i) => (
                        <ReceiptAmount
                          key={field}
                          label={
                            [
                              "Receipt tax",
                              "Receipt discount",
                              "Receipt other charges",
                            ][i]
                          }
                          value={data.receipt![field]}
                          signed={field === "extraCents"}
                          change={(value) => {
                            if (value !== null)
                              update({
                                receipt: { ...data.receipt!, [field]: value },
                              });
                          }}
                        />
                      ))}
                    </div>
                    <p>
                      Tax is reference only when prices include tax. Receipt
                      adjustments are additional to item-specific entries.
                    </p>
                    <Button
                      variant="secondary"
                      onClick={() =>
                        void run("Calculating…", async () => {
                          const saved = await save();
                          const result = await api.prices(
                            saved.id,
                            saved.revision,
                          );
                          setWarnings(result.warnings);
                          await save({
                            ...saved,
                            data: { ...saved.data, items: result.items },
                          });
                        })
                      }
                    >
                      Apply adjustments to final costs
                    </Button>
                    <p>
                      This calculates final costs while keeping any final costs
                      you entered manually.
                    </p>
                  </fieldset>
                )}
                {data.items.length > 0 && (
                  <Button
                    variant="text"
                    disabled={naming}
                    onClick={() =>
                      void run("Saving…", async () => {
                        const saved = await save();
                        void nameItems(saved);
                      })
                    }
                  >
                    Retry names, replacing unchanged names
                  </Button>
                )}
                {nameError && <p role="alert">{nameError}</p>}
                {naming && (
                  <p role="status">
                    Interpreting product names… You can keep editing or initiate
                    without waiting.
                  </p>
                )}
              </>
            )}
            <ReceiptAmount
              label="Actual paid total · CAD"
              value={data.totalCents}
              change={(totalCents) => update({ totalCents })}
            />
            {data.mode === "manual" ? (
              <ReceiptAmount
                label="My share · CAD"
                value={data.ownShareCents}
                change={(ownShareCents) => {
                  if (ownShareCents !== null) update({ ownShareCents });
                }}
              />
            ) : (
              <p>
                Item costs {money(itemTotal)} · Difference{" "}
                {data.totalCents === null
                  ? "Enter the paid total"
                  : money(data.totalCents - itemTotal)}
                . The final difference after participants confirm is assigned to
                you. Your effective cost must stay nonnegative.
              </p>
            )}
            <label>
              Notes
              <textarea
                maxLength={2000}
                value={data.notes}
                onChange={(e) => update({ notes: e.target.value })}
              />
            </label>
          </fieldset>
          {warnings.map((w, i) => (
            <p className="bill-warning" key={i}>
              {w}
            </p>
          ))}
          {error && (
            <div role="alert">
              <p>{error}</p>
              <Button
                variant="text"
                onClick={() =>
                  void run("Reloading…", async () => {
                    const result = await api.get(draft.id);
                    setDraft(result.draft);
                  })
                }
              >
                Reload saved draft, discarding local edits
              </Button>
            </div>
          )}
          <p role="status">{busy || notice}</p>
          {draft.initializationRevision && (
            <p>
              Initiation response was not received. Retry sends the same saved
              bill.
            </p>
          )}
          <div className="dialog-actions">
            <Button type="submit" disabled={!!busy || !valid}>
              {draft.initializationRevision
                ? "Retry initiation"
                : "Initiate bill"}
            </Button>
            <Button
              variant="secondary"
              disabled={!!busy}
              onClick={() =>
                void run("Saving draft…", async () => {
                  await save();
                  clearLocal();
                  close();
                })
              }
            >
              Save draft & close
            </Button>
          </div>
          <p>
            {data.mode === "items"
              ? "Initiating opens claiming. Everyone, including you, confirms their own items afterward."
              : "Initiating confirms only your manual share. Other participants enter their own amounts."}
          </p>
        </form>
      )}
    </Dialog>
  );
}

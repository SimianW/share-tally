// THROWAWAY: Which New bill flow works best? Three structures, switched with ?variant=A|B|C.
// All edits stay in memory. No API calls, OCR requests, or saved bills.
import { useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Camera,
  Upload,
  Plus,
  Trash2,
  ReceiptText,
  PencilLine,
  ChevronDown,
} from "lucide-react";
import Dialog from "./Dialog";
import { Button, Logo } from "./ui";
import "./play.css";
import "./NewBill.prototype.css";

type Item = { id: number; name: string; price: string };
type Props = { groupName?: string; members?: string[]; close?: () => void };
const variants = ["A", "B", "C"] as const;
type Variant = (typeof variants)[number];
const names = { A: "分步引导", B: "双栏工作台", C: "折叠清单" };
const descriptions = {
  A: "每一步只处理一件事，适合手机和第一次使用。",
  B: "收据与商品并排核对，适合电脑和较长的购物清单。",
  C: "留在同一页，完成一段收起一段，随时回头修改。",
};
function readVariant(): Variant {
  const value = new URLSearchParams(location.search).get("variant");
  return variants.includes(value as Variant) ? (value as Variant) : "A";
}

export default function NewBillPrototype({
  groupName = "Weekend groceries",
  members = ["You", "Alex", "Jamie"],
  close,
}: Props) {
  const [variant, setVariant] = useState(readVariant);
  const [step, setStep] = useState(0);
  const [section, setSection] = useState(0);
  const [items, setItems] = useState<Item[]>([]);
  const [photo, setPhoto] = useState(false);
  const [title, setTitle] = useState("Weekend groceries");
  const [date, setDate] = useState("2026-09-16");
  const [people, setPeople] = useState(members);
  const [mode, setMode] = useState("items");
  const [paid, setPaid] = useState("");
  const [tax, setTax] = useState("0");
  const [discount, setDiscount] = useState("0");
  const [done, setDone] = useState(false);
  const [saved, setSaved] = useState(false);
  const sum = items.reduce((n, item) => n + (Number(item.price) || 0), 0);
  const total = Math.max(0, sum + (Number(tax) || 0) - (Number(discount) || 0));
  const amount = Number(paid) || 0;
  const valid =
    title.trim() &&
    amount > 0 &&
    (mode === "manual" ||
      (items.length > 0 &&
        items.every((i) => i.name.trim() && Number(i.price) > 0) &&
        Math.abs(total - amount) < 0.005));
  const money = (n: number) =>
    n.toLocaleString("en-CA", { style: "currency", currency: "CAD" });
  function changeVariant(next: Variant) {
    const url = new URL(location.href);
    url.searchParams.set("variant", next);
    history.replaceState(null, "", url);
    setVariant(next);
  }
  useEffect(() => {
    function keys(event: KeyboardEvent) {
      if (
        event.target instanceof Element &&
        event.target.closest("input, textarea, select, [contenteditable]")
      )
        return;
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const offset = event.key === "ArrowRight" ? 1 : 2;
      changeVariant(variants[(variants.indexOf(variant) + offset) % 3]);
    }
    const sync = () => setVariant(readVariant());
    window.addEventListener("keydown", keys);
    window.addEventListener("popstate", sync);
    return () => {
      window.removeEventListener("keydown", keys);
      window.removeEventListener("popstate", sync);
    };
  }, [variant]);
  function sample() {
    setItems([
      { id: 1, name: "Organic strawberries", price: "8.99" },
      { id: 2, name: "Croissants · 12 pack", price: "7.49" },
      { id: 3, name: "Kirkland oat milk", price: "12.99" },
    ]);
    setPhoto(true);
    setPaid("29.47");
    setTax("0");
    setDiscount("0");
    setStep(1);
    setSection(0);
  }
  function add() {
    setItems((list) => [...list, { id: Date.now(), name: "", price: "" }]);
  }
  function reset() {
    setItems([]);
    setPhoto(false);
    setPaid("");
    setTax("0");
    setDiscount("0");
    setStep(0);
    setSection(0);
    setDone(false);
    setSaved(false);
  }
  const source = (
    <div className="nb-source">
      <div className="nb-source-icon">
        <ReceiptText size={30} />
      </div>
      <h3>Start with your receipt</h3>
      <p>Bring in your shopping list, then check the details.</p>
      <div className="nb-source-actions">
        <Button variant="primary" onClick={sample}>
          <Upload size={18} /> Try a sample receipt
        </Button>
        <Button variant="secondary" className="nb-camera" onClick={sample}>
          <Camera size={18} /> Try photo flow
        </Button>
      </div>
      <span className="nb-caption">Demo image · no upload or AI call</span>
    </div>
  );
  const manualEntry = (
    <Button
      variant="secondary"
      onClick={() => {
        if (!items.length) add();
        setStep(1);
        setSection(0);
      }}
    >
      <PencilLine size={17} /> Enter items myself
    </Button>
  );
  const itemEditor = (
    <div className="nb-items">
      <div className="nb-section-heading">
        <div>
          <h3>Check your items</h3>
          <p>
            {photo
              ? "Sample scan ready. Edit anything that needs correcting."
              : "Add the items everyone will claim."}
          </p>
        </div>
        <span className="nb-tag">{items.length} items</span>
      </div>
      {items.length === 0 && (
        <div className="nb-empty">
          No items yet. Try the sample receipt or add your first item.
        </div>
      )}
      {items.map((item, index) => (
        <div className="nb-item" key={item.id}>
          <span className="nb-number">{index + 1}</span>
          <label>
            Item name
            <input
              aria-label={`Item ${index + 1} name`}
              placeholder="e.g. Organic strawberries"
              value={item.name}
              onChange={(e) =>
                setItems(
                  items.map((i) =>
                    i.id === item.id ? { ...i, name: e.target.value } : i,
                  ),
                )
              }
            />
          </label>
          <label>
            Cost · CAD
            <input
              aria-label={`Item ${index + 1} cost`}
              inputMode="decimal"
              placeholder="0.00"
              value={item.price}
              onChange={(e) =>
                setItems(
                  items.map((i) =>
                    i.id === item.id ? { ...i, price: e.target.value } : i,
                  ),
                )
              }
            />
          </label>
          <button
            className="nb-icon"
            aria-label={`Remove item ${index + 1}`}
            onClick={() => setItems(items.filter((i) => i.id !== item.id))}
          >
            <Trash2 size={17} />
          </button>
        </div>
      ))}
      <Button variant="secondary" onClick={add}>
        <Plus size={17} /> Add an item
      </Button>
      <div className="nb-subtotal">
        <span>Item subtotal</span>
        <strong>{money(sum)}</strong>
      </div>
      <details className="nb-adjustments">
        <summary>
          Tax, discounts & other details <ChevronDown size={16} />
        </summary>
        <p>
          Optional receipt adjustments. Sample item costs already include tax.
        </p>
        <div className="nb-two">
          <label>
            Additional tax
            <input
              inputMode="decimal"
              value={tax}
              onChange={(e) => setTax(e.target.value)}
            />
          </label>
          <label>
            Receipt discount
            <input
              inputMode="decimal"
              value={discount}
              onChange={(e) => setDiscount(e.target.value)}
            />
          </label>
        </div>
      </details>
    </div>
  );
  const basics = (
    <div className="nb-basics">
      <div className="nb-two">
        <label>
          Bill title
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label>
          Purchase date
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
      </div>
      <h3>Who shared this purchase?</h3>
      <p>You paid. Choose who will share the bill.</p>
      <div className="nb-people">
        {members.map((name, index) => (
          <button
            key={`${name}-${index}`}
            aria-pressed={people.includes(name)}
            disabled={index === 0}
            onClick={() =>
              setPeople(
                people.includes(name)
                  ? people.filter((n) => n !== name)
                  : [...people, name],
              )
            }
          >
            <span className="nb-avatar">{name.slice(0, 1)}</span>
            {name}
            {people.includes(name) && <Check size={15} />}
          </button>
        ))}
      </div>
      <label>
        How will you split it?
        <select value={mode} onChange={(e) => setMode(e.target.value)}>
          <option value="items">Everyone claims their items</option>
          <option value="manual">Everyone enters their own share</option>
        </select>
      </label>
      <p className="nb-caption">
        {mode === "items"
          ? "People choose their items after you create the bill."
          : "People enter an amount after you create the bill."}
      </p>
    </div>
  );
  const amountEditor = (
    <div className="nb-amount">
      <label>
        Actual amount you paid <span>CAD</span>
        <input
          aria-label="Actual amount paid"
          inputMode="decimal"
          placeholder="0.00"
          value={paid}
          onChange={(e) => setPaid(e.target.value)}
        />
      </label>
      {mode === "items" && (
        <div
          className={
            Math.abs(total - amount) < 0.005 && amount > 0
              ? "nb-match"
              : "nb-hint"
          }
        >
          {amount > 0 && Math.abs(total - amount) < 0.005 ? (
            <>
              <Check size={16} /> Items and total match
            </>
          ) : (
            <>
              Item total: {money(total)}
              {amount > 0
                ? ` · Difference: ${money(amount - total)}`
                : " · Check against your receipt"}
            </>
          )}
        </div>
      )}
    </div>
  );
  const receipt = (
    <div className="nb-paper">
      <ReceiptText size={22} />
      <h3>COSTCO</h3>
      <p>WHOLESALE · SAMPLE RECEIPT</p>
      <div className="nb-paper-rule" />
      {[
        { n: "STRAWBERRIES", p: "8.99" },
        { n: "CROISSANTS", p: "7.49" },
        { n: "OAT MILK", p: "12.99" },
      ].map((i) => (
        <div key={i.n}>
          <span>{i.n}</span>
          <span>{i.p}</span>
        </div>
      ))}
      <div className="nb-paper-rule" />
      <div>
        <strong>TOTAL CAD</strong>
        <strong>29.47</strong>
      </div>
      <p>Thank you. See you next time!</p>
    </div>
  );
  const submit = (
    <Button variant="primary" disabled={!valid} onClick={() => setDone(true)}>
      Create bill <ArrowRight size={17} />
    </Button>
  );
  const state = {
    variant,
    step: step + 1,
    section: section + 1,
    title,
    date,
    mode,
    people,
    photo,
    items,
    tax,
    discount,
    paid,
    ready: Boolean(valid),
    done,
    saved,
  };
  const switcher = (
    <nav className="nb-switcher" aria-label="Prototype variants">
      <button
        aria-label="Previous variant"
        onClick={() =>
          changeVariant(variants[(variants.indexOf(variant) + 2) % 3])
        }
      >
        <ArrowLeft size={18} />
      </button>
      {variants.map((v) => (
        <button
          key={v}
          aria-pressed={v === variant}
          onClick={() => changeVariant(v)}
        >
          {v} <span>{names[v]}</span>
        </button>
      ))}
      <button
        aria-label="Next variant"
        onClick={() =>
          changeVariant(variants[(variants.indexOf(variant) + 1) % 3])
        }
      >
        <ArrowRight size={18} />
      </button>
    </nav>
  );
  return (
    <Dialog
      title="New bill"
      kicker={groupName}
      close={
        close ??
        (() => {
          location.hash = "";
        })
      }
      className={`nb-dialog nb-variant-${variant}`}
    >
      <div className="nb-design-note">
        <div>
          <strong>
            {variant} · {names[variant]}
          </strong>
          <span>{descriptions[variant]}</span>
        </div>
        <button onClick={reset}>重新体验</button>
      </div>
      {done ? (
        <div className="nb-success">
          <span className="nb-success-icon">
            <Check size={32} />
          </span>
          <h2>Ready for everyone.</h2>
          <p>
            {title} · {money(amount)} · {people.length} people
          </p>
          <p>
            {mode === "items"
              ? "Your friends can now claim their items."
              : "Your friends can now enter their shares."}
          </p>
          <div className="nb-hint">原型演示完成，没有创建真实账单。</div>
          <Button variant="secondary" onClick={() => setDone(false)}>
            Back to editing
          </Button>
        </div>
      ) : (
        <>
          {variant === "A" && (
            <div className="nb-wizard">
              <ol className="nb-steps">
                {[
                  "Bring your receipt",
                  "Check the items",
                  "Share the bill",
                ].map((label, i) => (
                  <li key={label}>
                    <button
                      aria-current={step === i ? "step" : undefined}
                      onClick={() => setStep(i)}
                    >
                      <span>
                        {step > i ? <Check size={15} /> : `0${i + 1}`}
                      </span>
                      {label}
                    </button>
                  </li>
                ))}
              </ol>
              <div className="nb-wizard-body">
                {step === 0 ? (
                  <>
                    <div className="nb-intro">
                      <h2>A shared shop starts here.</h2>
                      <p>
                        Use a receipt to fill in the items, or enter them
                        yourself.
                      </p>
                    </div>
                    {source}
                    <div className="nb-or">
                      <span>or</span>
                    </div>
                    <div className="nb-manual-choice">
                      {manualEntry}
                      <p>
                        Already know the total?{" "}
                        <button
                          onClick={() => {
                            setMode("manual");
                            setStep(2);
                          }}
                        >
                          Split by amounts
                        </button>
                      </p>
                    </div>
                  </>
                ) : step === 1 ? (
                  <>
                    {photo && (
                      <div className="nb-scan-banner">
                        <Check size={18} />
                        <span>
                          3 sample items imported. Please review the names and
                          costs.
                        </span>
                      </div>
                    )}
                    {itemEditor}
                  </>
                ) : (
                  <>
                    {basics}
                    {amountEditor}
                    <div className="nb-hint">
                      Creating the bill invites {people.length - 1} other{" "}
                      {people.length === 2 ? "person" : "people"} to{" "}
                      {mode === "items" ? "claim items" : "enter their shares"}.
                      No money is transferred.
                    </div>
                  </>
                )}
              </div>
              <footer className="nb-footer">
                <Button
                  variant="text"
                  onClick={() =>
                    step > 0 ? setStep(step - 1) : setSaved(true)
                  }
                >
                  {step > 0 ? "Back" : "Save for later"}
                </Button>
                {step === 2 ? (
                  submit
                ) : (
                  <Button variant="primary" onClick={() => setStep(step + 1)}>
                    {step === 0
                      ? "Enter items manually"
                      : "Continue to sharing"}
                    <ArrowRight size={17} />
                  </Button>
                )}
              </footer>
            </div>
          )}
          {variant === "B" && (
            <div className="nb-workbench">
              <div className="nb-workbench-meta">
                <label>
                  Bill title
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                  />
                </label>
                <label>
                  Purchase date
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                  />
                </label>
              </div>
              <div className="nb-desk">
                <aside>
                  <div className="nb-section-heading">
                    <h3>Receipt</h3>
                    <span className="nb-tag">Private to you</span>
                  </div>
                  {photo ? (
                    <>
                      {receipt}
                      <Button variant="secondary" onClick={sample}>
                        Replace sample
                      </Button>
                    </>
                  ) : (
                    source
                  )}
                  <p className="nb-caption">
                    Keep the receipt in view while checking each item.
                  </p>
                </aside>
                <section>
                  {mode === "items" ? (
                    itemEditor
                  ) : (
                    <div className="nb-empty">
                      Your friends will enter their own amounts.
                    </div>
                  )}
                  <details className="nb-adjustments">
                    <summary>
                      Sharing settings · {people.length} people
                      <ChevronDown size={16} />
                    </summary>
                    {basics}
                  </details>
                </section>
              </div>
              <footer className="nb-desk-footer">
                {amountEditor}
                <div>
                  <Button variant="text" onClick={() => setSaved(true)}>
                    Save for later
                  </Button>
                  {submit}
                </div>
              </footer>
            </div>
          )}
          {variant === "C" && (
            <div className="nb-checklist">
              <div className="nb-checklist-intro">
                <h2>One shop. Everyone included.</h2>
                <p>Work through your bill at your own pace.</p>
              </div>
              {["Receipt & items", "Who’s sharing", "Check the total"].map(
                (label, i) => (
                  <section
                    className={`nb-fold ${section === i ? "is-open" : ""}`}
                    key={label}
                  >
                    <button
                      className="nb-fold-heading"
                      aria-expanded={section === i}
                      onClick={() => setSection(section === i ? -1 : i)}
                    >
                      <span className="nb-fold-number">
                        {i === 0 && items.length ? <Check size={18} /> : i + 1}
                      </span>
                      <span>
                        <strong>{label}</strong>
                        <small>
                          {i === 0
                            ? `${items.length} items · ${money(total)}`
                            : i === 1
                              ? `${people.length} people · ${mode === "items" ? "Claim items" : "Manual shares"}`
                              : amount
                                ? `${money(amount)} paid`
                                : "Enter the amount on your receipt"}
                        </small>
                      </span>
                      <ChevronDown size={18} />
                    </button>
                    {section === i && (
                      <div className="nb-fold-body">
                        {i === 0 ? (
                          <>
                            {!photo && items.length === 0 ? (
                              <>
                                {source}
                                <div className="nb-manual-choice">
                                  {manualEntry}
                                </div>
                              </>
                            ) : (
                              <>
                                {photo && (
                                  <details className="nb-adjustments">
                                    <summary>
                                      View sample receipt
                                      <ChevronDown size={16} />
                                    </summary>
                                    {receipt}
                                  </details>
                                )}
                                {itemEditor}
                              </>
                            )}
                            <Button
                              variant="primary"
                              onClick={() => setSection(1)}
                            >
                              Next: who’s sharing <ArrowRight size={16} />
                            </Button>
                          </>
                        ) : i === 1 ? (
                          <>
                            {basics}
                            <Button
                              variant="primary"
                              onClick={() => setSection(2)}
                            >
                              Next: check total <ArrowRight size={16} />
                            </Button>
                          </>
                        ) : (
                          <>
                            {amountEditor}
                            <div className="nb-hint">
                              {people.length} people will{" "}
                              {mode === "items"
                                ? "claim items"
                                : "enter their shares"}{" "}
                              after this bill is created.
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </section>
                ),
              )}
              <footer className="nb-footer">
                <Button variant="text" onClick={() => setSaved(true)}>
                  Save for later
                </Button>
                {submit}
              </footer>
            </div>
          )}
        </>
      )}
      {saved && (
        <p className="nb-hint" role="status">
          原型草稿保留在当前页面内，刷新后清空。
        </p>
      )}
      <details className="nb-state">
        <summary>原型状态 · 仅内存数据 · 不会提交真实账单</summary>
        <pre>{JSON.stringify(state, null, 2)}</pre>
      </details>
      {switcher}
    </Dialog>
  );
}

export function PrototypeScene() {
  const [open, setOpen] = useState(true);
  return (
    <div className="play nb-scene">
      <header>
        <Logo />
        <span>Design preview · 示例群组</span>
      </header>
      <main>
        <p className="eyebrow">YOUR GROUP</p>
        <h1>Weekend groceries</h1>
        <p>Alex, Jamie and you · CAD</p>
        <Button variant="primary" onClick={() => setOpen(true)}>
          New bill
        </Button>
        <div className="nb-scene-cards">
          <article>
            <p>YOUR BALANCE</p>
            <h2>All settled up.</h2>
            <p>A good place to start the next shared shop.</p>
          </article>
          <article>
            <p>SHARED PURCHASES</p>
            <h2>Saturday groceries</h2>
            <p>$64.80 · Completed</p>
          </article>
        </div>
      </main>
      {open && <NewBillPrototype close={() => setOpen(false)} />}
    </div>
  );
}

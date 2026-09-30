// PROTOTYPE for #150 — throwaway, do not ship.
// Plan: three variants of the By amount share picker, switchable via ?variant=A|B|C.
// The page: a Scenario panel, the draft setup / participant share form / By item reference
// views wrapped in chrome resembling the real pages, a State readout, and the variant switcher.
import { useState, type ReactNode } from "react";
import { ArrowLeft, CircleDollarSign, ListChecks } from "lucide-react";
import { money, type Bill } from "../bill-api";
import { cost, lessOrEqual, one, parse, subtract, sum, text as fractionText, shortText, claimable, type Fraction } from "../claim-fractions";
import { ClaimPortion } from "../ClaimPortion";
import { BillPanel, ShareTicket } from "../BillOverview";
import { Notification } from "../Notification";
import { ReceiptAmount } from "../ReceiptAmount";
import { SegmentedControl } from "../SegmentedControl";
import { Avatar, Button, Icon } from "../ui";
import { savePalette, saveScheme } from "../appearance";
import { palettes, type PaletteKey } from "../palettes";
import { AmountPortion, FractionText, type Variant } from "./AmountPortion";
import { amountText, choicesFor, fractionLabel, parseCents, pressedChoice, tally, type Other } from "./amount-portion";
import { PrototypeSwitcher } from "./PrototypeSwitcher";
import { draftTotal, participantBill, people, readScenario, referenceItem, scenarioKey, writeScenario, needsAmountCorrection, type Scenario, type Scheme } from "./scenarios";
import "../play.css";
import "../bills.css";
import "../receipts.css";
import "../receipt-review.css";
import "../participant-picker.css";
import "./prototype.css";

const variants = [
  { key: "A", name: "Editable figure" },
  { key: "B", name: "Separate amount field" },
  { key: "C", name: "Custom handles amounts" },
] as const satisfies readonly { key: Variant; name: string }[];

const readVariant = (): Variant => {
  const value = new URLSearchParams(location.search).get("variant");
  return value === "B" || value === "C" ? value : "A";
};

export default function AmountPortionPrototype() {
  const [variant, setVariant] = useState<Variant>(readVariant);
  const [scenario, setScenario] = useState<Scenario>(() => readScenario(
    new URLSearchParams(location.search),
    document.documentElement.dataset.scheme === "dark" ? "dark" : "light",
    (document.documentElement.dataset.palette ?? "classic") as PaletteKey,
  ));
  function update(patch: Partial<Scenario>) {
    const next = { ...scenario, ...patch };
    if (patch.scheme) saveScheme(patch.scheme);
    if (patch.palette) savePalette(patch.palette);
    setScenario(next);
    history.replaceState(null, "", writeScenario(next, variant));
  }
  const key = scenarioKey(scenario);
  return <div className="play proto-page">
    <main className="main-content" id="main-content">
      {scenario.view === "participant" && <ParticipantView key={key} s={scenario} variant={variant} />}
      {scenario.view === "draft" && <DraftView key={key} s={scenario} variant={variant} />}
      {scenario.view === "items" && <ItemsReference key={key} s={scenario} variant={variant} />}
    </main>
    <ScenarioPanel s={scenario} update={update} />
    <PrototypeSwitcher variants={variants} value={variant} onChange={setVariant} />
  </div>;
}

/* ---------- Participant share form on the bill page ---------- */

function ParticipantView({ s, variant }: { s: Scenario; variant: Variant }) {
  const { bill, oldTotalCents } = participantBill(s);
  const own = bill.participants[0];
  const others = othersOf(bill);
  const [amount, setAmount] = useState(own.amountCents === null ? "" : amountText(own.amountCents));
  const [custom, setCustom] = useState<Fraction | null>(null);
  const [validation, setValidation] = useState("");
  const [submitted, setSubmitted] = useState("");
  const terminal = !!bill.completedAt || !!bill.canceledAt;
  const mine = parseCents(amount);
  const changed = own.amountCents !== null && mine !== own.amountCents;
  const correction = needsAmountCorrection(bill);
  const initiator = bill.participants.find((p) => p.userId === bill.initiatorId)!;
  const isInitiator = own.userId === bill.initiatorId;
  return <section className="bill-page">
    <header className="bill-header">
      <a className="bill-back" href="#" onClick={(event) => event.preventDefault()}><Icon name="left" size={16} />Group bills</a>
      <h1>{bill.title}</h1>
      <p className="bill-meta">{bill.purchaseDate}, paid by {isInitiator ? "you" : initiator.displayName}, in CAD</p>
    </header>
    <div className="bill-main">
      {correction && <Notification tone="warning" title={`Shares are ${money(Math.abs(bill.differenceCents))} ${bill.differenceCents < 0 ? "over" : "under"} the total`}>
        <p>This bill cannot complete yet. Check your amount and correct it if needed. The combined shares must be within $0.05 of the bill total.</p>
        <p>Changing a saved amount requires everyone to confirm again. The initiator’s new amount is confirmed when saved. Confirming unchanged amounts will not fix the difference.</p>
        <Button variant="secondary" onClick={() => document.getElementById("my-share-amount")?.focus()}>Edit my share</Button>
      </Notification>}
      <ShareTicket bill={bill} own={own} needsAmountCorrection={correction}>
        <form className="share-form" noValidate onSubmit={(event) => {
          event.preventDefault();
          setSubmitted("");
          if (mine === null) { setValidation("Enter a valid CAD amount, with at most two decimals."); return; }
          if (mine > bill.totalCents) { setValidation("Your share can't be more than the total paid."); return; }
          setValidation("");
          setSubmitted(`Stub: would submit ${money(mine)} (expected ${own.amountCents === null ? "none" : money(own.amountCents)}, revision ${bill.revision}). No network.`);
        }}>
          <span className="eyebrow">YOUR SHARE</span>
          <h2>{own.confirmedAt ? "Your share is confirmed." : own.amountCents === null ? "Confirm your share" : "Check your saved amount."}</h2>
          <AmountPortion variant={variant} totalCents={bill.totalCents} count={bill.participants.length} others={others}
            text={amount} onType={(value) => { setAmount(value); setSubmitted(""); }}
            onPick={(cents) => { setAmount(amountText(cents)); setSubmitted(""); }}
            custom={custom} setCustom={setCustom} readOnly={terminal} inputId="my-share-amount" />
          <p>
            {terminal ? "This bill is final. Your share can no longer be changed."
              : changed ? isInitiator
                ? "Saving confirms your new amount. Other participants will need to confirm again."
                : "Changing your amount clears everyone’s confirmation, including yours. Review and confirm again after saving."
                : own.amountCents === null ? "Include your tax, discounts, and rounding. Enter 0 if you have no cost."
                  : own.confirmedAt ? "You can still edit your amount above. Saving a change will require renewed confirmations."
                    : "Confirming the same amount keeps everyone else’s confirmation."}
          </p>
          {validation && <Notification>{validation}</Notification>}
          {submitted && <Notification tone="success" title="Prototype">{submitted}</Notification>}
          {!terminal && <Button type="submit" disabled={!!own.confirmedAt && !changed}>
            {changed ? "Save changed amount" : own.amountCents === null ? "Submit and confirm my share" : "Confirm my share"}
          </Button>}
        </form>
      </ShareTicket>
      <StateReadout totalCents={bill.totalCents} mineCents={mine} count={bill.participants.length} others={others} custom={custom}
        extra={[
          ["saved (cents)", own.amountCents === null ? "none" : String(own.amountCents)],
          ...(oldTotalCents !== null ? [["old total", `${oldTotalCents} → ${bill.totalCents} (reopened)`] as [string, string]] : []),
        ]} />
    </div>
    <BillPanel bill={bill} needsAmountCorrection={correction} initiatorActions={null} />
  </section>;
}

function othersOf(bill: Bill): Other[] {
  return bill.participants.filter((p) => !p.isCurrentUser).map((p) => ({
    person: { id: p.userId, displayName: p.displayName, imageUrl: p.imageUrl }, cents: p.amountCents,
  }));
}

/* ---------- Draft setup (initiator), People step ---------- */

function DraftView({ s, variant }: { s: Scenario; variant: Variant }) {
  const initialTotal = draftTotal(s);
  const [totalCents, setTotalCents] = useState<number | null>(initialTotal);
  const [share, setShare] = useState(s.over && initialTotal !== null ? amountText(initialTotal + 500) : "");
  const [custom, setCustom] = useState<Fraction | null>(null);
  // The portion the share followed when Total paid was cleared, so re-entering a total can follow it again.
  const [parked, setParked] = useState<Fraction | null>(null);
  const members = people.slice(0, s.n);
  const others: Other[] = members.slice(1).map((person) => ({ person, cents: null }));
  const choices = choicesFor(s.n);
  function changeTotal(next: number | null) {
    const linked = totalCents !== null ? pressedChoice(choices, totalCents, parseCents(share), custom)?.fraction ?? null : parked;
    setTotalCents(next);
    if (next === null) { setParked(linked); return; }
    setParked(null);
    if (linked) setShare(amountText(cost(next, linked)));
  }
  return <section className="receipt-page">
    <div className="receipt-wizard">
      <header className="receipt-page-heading">
        <Button variant="text"><ArrowLeft size={18} aria-hidden="true" /> Back to group</Button>
        <div className="eyebrow">SHARETALLY / NEW BILL</div>
        <h1>New bill <span>· Costco crew</span></h1>
      </header>
      <form className="bill-form" noValidate onSubmit={(event) => event.preventDefault()}>
        <nav aria-label="New bill steps" className="receipt-steps">
          {["Receipt", "Items", "People"].map((label, index) => <button type="button" key={label} aria-current={index === 2 ? "step" : undefined}>
            <span>{index < 2 ? <Icon name="check" size={16} /> : `0${index + 1}`}</span>{label}
          </button>)}
        </nav>
        <h3 className="receipt-step-title">Who’s sharing this bill?</h3>
        <p className="receipt-step-description">Pick who's in and check what you paid.</p>
        <fieldset>
          <div className="receipt-sharing">
            <div className="sharing-details">
              <label>Bill title<input defaultValue="Costco run" /></label>
              <label>Purchase date<input type="date" defaultValue="2026-09-28" /></label>
            </div>
            <div className="proto-people">
              <span className="sharing-section-title">People · {s.n}</span>
              <span className="proto-people-list">{members.map((person, index) =>
                <span key={person.id}><Avatar name={person.displayName} small />{person.displayName}{index === 0 && " (you)"}</span>)}</span>
            </div>
            <DraftSplit variant={variant} totalCents={totalCents} changeTotal={changeTotal} count={s.n} others={others}
              share={share} setShare={(value) => { setShare(value); setParked(null); }} custom={custom} setCustom={setCustom} />
          </div>
        </fieldset>
        <div className="receipt-wizard-actions"><div /><Button type="submit">Share bill</Button></div>
      </form>
      <StateReadout totalCents={totalCents} mineCents={parseCents(share)} count={s.n} others={others} custom={custom}
        extra={[["follows on total change", (() => {
          const f = totalCents !== null ? pressedChoice(choices, totalCents, parseCents(share), custom)?.fraction : parked;
          return f ? fractionLabel(f) : "no (hand-typed)";
        })()]]} />
    </div>
  </section>;
}

function DraftSplit({ variant, totalCents, changeTotal, count, others, share, setShare, custom, setCustom }: {
  variant: Variant; totalCents: number | null; changeTotal: (cents: number | null) => void; count: number; others: Other[];
  share: string; setShare: (value: string) => void; custom: Fraction | null; setCustom: (f: Fraction) => void;
}) {
  const legendId = "proto-split-legend";
  return <fieldset className="sharing-split">
    <legend id={legendId} className="sharing-section-title">Split</legend>
    <SegmentedControl labelledBy={legendId} value="manual" onChange={() => undefined} options={[
      { value: "items", content: <><ListChecks aria-hidden="true" /> By item</> },
      { value: "manual", content: <><CircleDollarSign aria-hidden="true" /> By amount</> },
    ]} />
    <p className="split-hint">Everyone enters their own share.</p>
    <div className="split-amounts">
      <ReceiptAmount label="Total paid (CAD)" value={totalCents} change={changeTotal} />
    </div>
    <AmountPortion variant={variant} totalCents={totalCents} count={count} others={others} showPending={false}
      text={share} onType={setShare} onPick={(cents) => setShare(amountText(cents))}
      custom={custom} setCustom={setCustom} />
  </fieldset>;
}

/* ---------- By item reference, beside the By amount card for the same money ---------- */

function ItemsReference({ s, variant }: { s: Scenario; variant: Variant }) {
  const { item, participants } = referenceItem(s);
  const ownId = participants[0].userId;
  const room = subtract(one, sum(item.claims.filter((claim) => claim.userId !== ownId)));
  const [selection, setSelection] = useState(s.over ? "1/3" : "");
  const [customOpen, setCustomOpen] = useState(false);
  const [customText, setCustomText] = useState("");
  const [customError, setCustomError] = useState("");
  const [customChoice, setCustomChoice] = useState("");
  const [selectedCustom, setSelectedCustom] = useState(false);
  const mine = parse(selection);
  const over = mine && !lessOrEqual(mine, room) ? { left: room, by: subtract(mine, room) } : null;
  const activeLeft = over && claimable(over.left) ? over.left : null;
  function choose(value: string, isCustom = false) {
    setSelection(value);
    setSelectedCustom(isCustom);
    if (isCustom) setCustomChoice(value);
    setCustomOpen(false);
  }
  function saveCustom() {
    const value = parse(customText);
    if (!value) { setCustomError("Use a positive fraction up to 1, with numerator and denominator at most 10,000."); return; }
    if (!lessOrEqual(value, room)) { setCustomError(`Only ${fractionText(room)} is available to you.`); return; }
    choose(fractionText(value), true);
  }

  // The same item as a By amount bill: total $24.99, Alice's portion submitted as an amount.
  const aliceClaim = item.claims[0];
  const others: Other[] = participants.slice(1).map((p) => ({
    person: { id: p.userId, displayName: p.displayName },
    cents: p.userId === aliceClaim.userId ? cost(item.finalCents, { n: BigInt(aliceClaim.numerator), d: BigInt(aliceClaim.denominator) }) : null,
  }));
  const [amount, setAmount] = useState(mine ? amountText(cost(item.finalCents, mine)) : "");
  const [custom, setCustom] = useState<Fraction | null>(null);

  return <section className="proto-compare">
    <header className="proto-compare-header">
      <h1>By item vs By amount</h1>
      <p className="bill-meta">The real By item card and buttons (left) beside the By amount prototype, variant {variant} (right), for the same {money(item.finalCents)}.</p>
    </header>
    <div className="proto-sheet receipt-sheet">
      <span className="eyebrow">CLAIM AN ITEM · REAL CLAIMPORTION</span>
      <h2 className="proto-sheet-title">{item.name} · {money(item.finalCents)}</h2>
      <p className="receipt-field-help">{fractionText(room)} available to you. Other claims and reservations hold the rest. Your choices are not submitted until you confirm.</p>
      <div className="claim-options">
        <ClaimPortion item={item} participants={participants} ownId={ownId} mine={mine} changes={[]} over={over} />
        <div className="claim-portion-choices" role="group" aria-label="Your portion">
          {([["1", "All of it"], ["1/2", "1/2"], ["1/3", "1/3"], ["1/4", "1/4"], ["1/5", "1/5"], ["1/6", "1/6"]] as const).map(([value, label]) => {
            const f = parse(value)!;
            return <button type="button" key={value} aria-label={`${label} · ${money(cost(item.finalCents, f))}`}
              aria-pressed={!customOpen && !selectedCustom && mine?.n === f.n && mine?.d === f.d}
              disabled={!lessOrEqual(f, room)} onClick={() => choose(value)}>
              <b>{value === "1" ? "All" : <FractionText value={f} />}</b><small>{money(cost(item.finalCents, f))}</small>
            </button>;
          })}
          {(() => {
            const customF = customChoice ? parse(customChoice) : null;
            return <button type="button" className="claim-portion-custom" aria-label={customF ? `Custom · ${customChoice} · ${money(cost(item.finalCents, customF))}` : "Custom"}
              aria-pressed={!customOpen && selectedCustom} disabled={room.n <= 0n}
              onClick={() => { setCustomOpen(true); setCustomText(customChoice || selection || ""); setCustomError(""); }}>
              <b>{customF ? <FractionText value={customF} /> : "…"}</b><small>{customF ? money(cost(item.finalCents, customF)) : "Custom"}</small>
            </button>;
          })()}
        </div>
        {activeLeft && <Button variant="secondary" className="claim-take-left" onClick={() => choose(fractionText(activeLeft))}>
          Take the {shortText(activeLeft)} left · {money(cost(item.finalCents, activeLeft))}
        </Button>}
        {customOpen && <div className="claim-custom"><label>Custom fraction<input autoFocus aria-label="Custom fraction" placeholder="4/5" value={customText}
          onChange={(event) => setCustomText(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") saveCustom(); }} /></label>
          <Button onClick={saveCustom}>Use custom fraction</Button>{customError && <p role="alert">{customError}</p>}</div>}
        {!!selection && <Button variant="text" className="claim-remove" onClick={() => choose("")}>Remove my claim</Button>}
      </div>
    </div>
    <div className="proto-sheet share-form proto-sheet-amount">
      <span className="eyebrow">BY AMOUNT · PROTOTYPE {variant}</span>
      <h2 className="proto-sheet-title">Confirm your share</h2>
      <AmountPortion variant={variant} totalCents={item.finalCents} count={participants.length} others={others}
        text={amount} onType={setAmount} onPick={(cents) => setAmount(amountText(cents))} custom={custom} setCustom={setCustom} />
      <StateReadout totalCents={item.finalCents} mineCents={parseCents(amount)} count={participants.length} others={others} custom={custom}
        extra={[["by item mine", mine ? `${fractionText(mine)} = ${cost(item.finalCents, mine)}` : "none"]]} />
    </div>
  </section>;
}

/* ---------- Prototype chrome ---------- */

function StateReadout({ totalCents, mineCents, count, others, custom, extra = [] }: {
  totalCents: number | null; mineCents: number | null; count: number; others: Other[]; custom: Fraction | null;
  extra?: [string, string][];
}) {
  const pressed = pressedChoice(choicesFor(count), totalCents, mineCents, custom);
  const { othersSum, difference } = tally(totalCents, others, mineCents);
  const rows: [string, string][] = [
    ["total (cents)", totalCents === null ? "empty" : String(totalCents)],
    ["mine (cents)", mineCents === null ? "none" : String(mineCents)],
    ["pressed", pressed ? `${pressed.even ? "Even · " : ""}${pressed.key === "custom" ? "Custom " : ""}${fractionLabel(pressed.fraction)}` : "none"],
    ["others", others.length ? others.map((o) => `${o.person.displayName} ${o.cents ?? "—"}`).join(", ") : "none"],
    ["sum (others + mine)", String(othersSum + (mineCents ?? 0))],
    ["total − sum", totalCents === null ? "n/a" : `${difference}${difference < 0 ? " (over)" : difference > 0 ? " (under)" : " (matched)"}`],
    ...extra,
  ];
  return <aside className="proto-readout" aria-label="Prototype state">
    <strong>State · prototype</strong>
    <dl>{rows.map(([term, value]) => <div key={term}><dt>{term}</dt><dd>{value}</dd></div>)}</dl>
  </aside>;
}

function ScenarioPanel({ s, update }: { s: Scenario; update: (patch: Partial<Scenario>) => void }) {
  const [open] = useState(() => window.innerWidth >= 1440);
  const participant = s.view === "participant";
  return <details className="proto-scenario" open={open}>
    <summary>Scenario <small>prototype #150</small></summary>
    <div className="proto-scenario-body">
      <Radios label="View" value={s.view} onChange={(view) => update({ view, total: view !== "draft" && s.total === "" ? "10000" : s.total })}
        options={[["draft", "Draft setup (initiator)"], ["participant", "Participant share form"], ["items", "By item reference"]]} />
      <label className="proto-field"><span>Participants N</span>
        <select value={s.n} onChange={(event) => update({ n: Number(event.target.value) })}>
          {people.map((_, index) => <option key={index} value={index + 1}>{index + 1} · {people.slice(0, index + 1).map((p) => p.displayName).join(", ")}</option>)}
        </select>
      </label>
      <label className="proto-field"><span>Total paid</span>
        <select value={s.total} disabled={s.view === "items" || s.reopened} onChange={(event) => update({ total: event.target.value as Scenario["total"] })}>
          <option value="10000">$100.00</option><option value="8743">$87.43</option><option value="1000">$10.00</option>
          <option value="" disabled={s.view !== "draft"}>empty (draft only)</option>
        </select>
      </label>
      <label className="proto-field"><span>Others submitted</span>
        <select value={s.others} disabled={!participant || s.over || s.terminal} onChange={(event) => update({ others: event.target.value as Scenario["others"] })}>
          <option value="none">none</option><option value="some">some</option><option value="all">all but me</option>
        </select>
      </label>
      <fieldset className="proto-checks">
        <legend>Situation</legend>
        <Check label="Over the total" checked={s.over} disabled={s.terminal} onChange={(over) => update({ over })} />
        <Check label="I saved an amount" checked={s.saved} disabled={!participant || s.reopened || s.terminal || s.over} onChange={(saved) => update({ saved })} />
        <Check label="Reopened ($100 → $120)" checked={s.reopened} disabled={!participant || s.terminal} onChange={(reopened) => update({ reopened })} />
        <Check label="Terminal (completed)" checked={s.terminal} disabled={!participant} onChange={(terminal) => update({ terminal, over: terminal ? false : s.over })} />
      </fieldset>
      <Radios label="Appearance" value={s.scheme} onChange={(scheme: Scheme) => update({ scheme })} options={[["light", "Light"], ["dark", "Dark"]]} />
      <label className="proto-field"><span>Palette</span>
        <select value={s.palette} onChange={(event) => update({ palette: event.target.value as PaletteKey })}>
          {palettes.map((p) => <option key={p.key} value={p.key}>{p.key}</option>)}
        </select>
      </label>
      <p className="proto-scenario-note">←/→ switch variant. Buttons are stubs; nothing is sent.</p>
    </div>
  </details>;
}

function Radios<Value extends string>({ label, value, options, onChange }: {
  label: string; value: Value; options: readonly (readonly [Value, ReactNode])[]; onChange: (value: Value) => void;
}) {
  return <fieldset className="proto-radios">
    <legend>{label}</legend>
    {options.map(([option, content]) => <label key={option}>
      <input type="radio" name={`proto-${label}`} checked={value === option} onChange={() => onChange(option)} />{content}
    </label>)}
  </fieldset>;
}

function Check({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void }) {
  return <label><input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />{label}</label>;
}

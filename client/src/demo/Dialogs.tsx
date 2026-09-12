import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  balances,
  money,
  needsMyShare,
  shortDate,
  type Bill,
  type DemoData,
  type Group,
} from "./data";
import { Avatar, Avatars, BillList, Button, Icon } from "./ui";

export type Modal =
  | { kind: "addBill"; groupId?: string }
  | { kind: "newGroup" }
  | { kind: "bill"; id: string }
  | { kind: "group"; id: string }
  | { kind: "attention" }
  | { kind: "settings" }
  | { kind: "receive" }
  | null;
export type NewBill = {
  title: string;
  groupId: string;
  participants: string[];
  total: number;
  share: number;
};
export type NewGroup = { name: string; icon: Group["icon"]; members: string[] };
type Props = {
  modal: Exclude<Modal, null>;
  data: DemoData;
  close: () => void;
  open: (modal: Modal) => void;
  addBill: (bill: NewBill) => void;
  addGroup: (group: NewGroup) => void;
  confirmShare: (id: string, cents: number) => void;
  receive: () => void;
  reset: () => void;
};
function Dialog({
  title,
  children,
  close,
  kicker = "A LITTLE LESS MATH",
}: {
  title: string;
  children: ReactNode;
  close: () => void;
  kicker?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const dialog = ref.current!;
    const previous = document.activeElement;
    dialog.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      dialog.close();
      document.body.style.overflow = overflow;
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="demo-dialog"
      aria-labelledby={id}
      onCancel={close}
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        if (
          e.target === e.currentTarget &&
          (e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom)
        )
          close();
      }}
    >
      <div className="dialog-heading">
        <div>
          <div className="eyebrow">{kicker}</div>
          <h2 id={id}>{title}</h2>
        </div>
        <button
          className="icon-button"
          aria-label="Close dialog"
          onClick={close}
        >
          <Icon name="close" />
        </button>
      </div>
      {children}
    </dialog>
  );
}
const centsFromInput = (value: string) =>
  /^\d{1,7}(\.\d{1,2})?$/.test(value) ? Math.round(Number(value) * 100) : null;
function BillForm({
  data,
  groupId,
  onSave,
}: {
  data: DemoData;
  groupId?: string;
  onSave: (bill: NewBill) => void;
}) {
  const [error, setError] = useState("");
  const [selectedGroupId, setSelectedGroupId] = useState(
    groupId || data.groups[0].id,
  );
  const [selectedOthers, setSelectedOthers] = useState<string[]>([]);
  const participantHintId = useId();
  const group = data.groups.find((g) => g.id === selectedGroupId)!;
  const otherMembers = group.members.filter((name) => name !== "Simon");
  const participants = [
    "Simon",
    ...otherMembers.filter((name) => selectedOthers.includes(name)),
  ];
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fields = new FormData(e.currentTarget);
    const total = centsFromInput(String(fields.get("total")));
    const share = centsFromInput(String(fields.get("share")));
    const title = String(fields.get("title")).trim();
    if (!title) return setError("Give this bill a name.");
    if (total === null || total <= 0 || share === null || share > total)
      return setError(
        "Enter a positive total and your share between $0 and the total, with up to two decimal places.",
      );
    if (participants.length === 1 && share !== total)
      return setError(
        "Choose someone to share this bill with, or enter the full total as your share.",
      );
    onSave({ title, total, share, groupId: selectedGroupId, participants });
  }
  return (
    <form className="demo-form" onSubmit={submit}>
      <p className="dialog-intro">
        You covered it. Let your people take it from here.
      </p>
      <label>
        What was it for?
        <input
          name="title"
          placeholder="e.g. Our weekly grocery run"
          maxLength={70}
          required
          autoFocus
        />
      </label>
      <label>
        Group
        <select
          name="group"
          value={selectedGroupId}
          onChange={(e) => {
            setSelectedGroupId(e.target.value);
            setSelectedOthers([]);
            setError("");
          }}
        >
          {data.groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      </label>
      <fieldset
        className="bill-participants"
        aria-describedby={participantHintId}
      >
        <legend>Who's sharing this bill?</legend>
        <p id={participantHintId} className="participant-hint">
          Pick the people who took part. Everyone confirms their own share.
        </p>
        <div className="participant-toolbar">
          <span role="status">
            {participants.length} selected, including you
          </span>
          <div>
            <button
              type="button"
              onClick={() => setSelectedOthers(otherMembers)}
              disabled={!otherMembers.length}
            >
              Select all
            </button>
            <button
              type="button"
              onClick={() =>
                setSelectedOthers(
                  otherMembers.filter((name) => !selectedOthers.includes(name)),
                )
              }
              disabled={!otherMembers.length}
            >
              Invert selection
            </button>
          </div>
        </div>
        <div className="participant-grid">
          {["Simon", ...otherMembers].map((name) => {
            const isInitiator = name === "Simon";
            const checked = participants.includes(name);
            return (
              <label
                key={name}
                className={`participant-option ${checked ? "selected" : ""} ${isInitiator ? "initiator" : ""}`}
              >
                <Avatar name={name} />
                <span className="participant-name">
                  <strong>{isInitiator ? "You" : name}</strong>
                  <small>
                    {isInitiator ? "Paid for this purchase" : "Group member"}
                  </small>
                </span>
                <input
                  type="checkbox"
                  name="participants"
                  value={name}
                  aria-label={
                    isInitiator ? "Simon, you are always included" : name
                  }
                  checked={checked}
                  disabled={isInitiator}
                  onChange={(e) =>
                    setSelectedOthers(
                      e.target.checked
                        ? [...selectedOthers, name]
                        : selectedOthers.filter(
                            (selected) => selected !== name,
                          ),
                    )
                  }
                />
              </label>
            );
          })}
        </div>
        <p className="participant-hint participant-footnote">
          You're always included. Select all and invert only change the other
          members.
        </p>
      </fieldset>
      <div className="form-columns">
        <label>
          Bill total
          <span className="amount-input">
            <span>$</span>
            <input
              name="total"
              inputMode="decimal"
              placeholder="0.00"
              required
            />
            <span>CAD</span>
          </span>
        </label>
        <label>
          Your share
          <span className="amount-input">
            <span>$</span>
            <input
              name="share"
              inputMode="decimal"
              placeholder="0.00"
              required
            />
            <span>CAD</span>
          </span>
        </label>
      </div>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <Button type="submit">
        Add bill
        <Icon name="plus" size={18} />
      </Button>
    </form>
  );
}
function GroupForm({ onSave }: { onSave: (group: NewGroup) => void }) {
  const [icon, setIcon] = useState<Group["icon"]>("basket");
  const [name, setName] = useState("");
  return (
    <form
      className="demo-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) {
          const fields = new FormData(e.currentTarget);
          onSave({
            name: name.trim(),
            icon,
            members: ["Simon", ...fields.getAll("members").map(String)],
          });
        }
      }}
    >
      <p className="dialog-intro">
        For the groceries, the getaways, and everything in between.
      </p>
      <fieldset className="icon-options">
        <legend>Pick a group icon</legend>
        {(["basket", "home", "sun"] as const).map((i) => (
          <label key={i} className={icon === i ? "selected" : ""}>
            <input
              type="radio"
              name="icon"
              value={i}
              checked={icon === i}
              onChange={() => setIcon(i)}
            />
            <Icon name={i} size={25} />
            <span className="sr-only">
              {i === "basket" ? "Shopping" : i === "home" ? "Home" : "Weekends"}
            </span>
          </label>
        ))}
      </fieldset>
      <label>
        Group name
        <input
          name="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Give your people a name"
          maxLength={40}
          required
          autoFocus
        />
      </label>
      <fieldset className="member-options">
        <legend>Add your people</legend>
        {["Emma", "Alex", "Jamie", "Riley"].map((n) => (
          <label key={n}>
            <Avatar name={n} />
            <span>{n}</span>
            <input
              type="checkbox"
              name="members"
              value={n}
              defaultChecked={n === "Emma"}
            />
          </label>
        ))}
      </fieldset>
      <Button type="submit" disabled={!name.trim()}>
        Create group
        <Icon name="arrow" size={18} />
      </Button>
    </form>
  );
}
function BillDetail({
  bill,
  group,
  confirm,
}: {
  bill: Bill;
  group: Group;
  confirm: Props["confirmShare"];
}) {
  const [amount, setAmount] = useState("");
  const [error, setError] = useState("");
  const isParticipant = bill.participants.includes("Simon");
  const canSubmit = needsMyShare(bill);
  const otherConfirmed =
    bill.id === "b1"
      ? 14040
      : bill.status !== "pending"
        ? bill.total - (bill.share ?? 0)
        : null;
  return (
    <div className="bill-detail">
      <div className="detail-total">
        <span>
          {group.name} · {shortDate(bill.date)}
        </span>
        <strong>
          {money(bill.total)}
          <small>CAD</small>
        </strong>
        <span>
          {bill.initiator === "Simon" ? "You" : bill.initiator} paid for this
          purchase
        </span>
      </div>
      <div className="detail-line">
        <span>Bill status</span>
        <span className={`bill-status ${bill.status}`}>
          {bill.status === "pending"
            ? "Awaiting shares"
            : bill.status === "complete"
              ? "Complete"
              : "Settled"}
        </span>
      </div>
      <div className="detail-line">
        <span>Participants · {bill.participants.length}</span>
        <Avatars names={bill.participants} />
      </div>
      <div className="bill-participant-names" aria-label="Bill participants">
        {bill.participants.map((name) => (
          <span key={name}>
            <Avatar name={name} small />
            {name === "Simon" ? "You" : name}
            {name === bill.initiator && <small>Paid the bill</small>}
          </span>
        ))}
      </div>
      <div className="detail-line">
        <span>Others' confirmed shares</span>
        <strong>
          {otherConfirmed === null ? "Awaiting shares" : money(otherConfirmed)}
        </strong>
      </div>
      <div className="detail-line">
        <span>Your confirmed share</span>
        <strong>
          {!isParticipant
            ? "Not participating"
            : bill.share === null
              ? "Not submitted"
              : money(bill.share)}
        </strong>
      </div>
      {canSubmit ? (
        <form
          className="demo-form share-form"
          onSubmit={(e) => {
            e.preventDefault();
            const cents = centsFromInput(amount);
            if (cents === null || cents > bill.total)
              return setError(
                "Enter a share from $0 up to the bill total, with at most two decimal places.",
              );
            confirm(bill.id, cents);
          }}
        >
          <label>
            Your share, including tax
            <span className="amount-input">
              <span>$</span>
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
                placeholder="0.00"
                required
                autoFocus
              />
              <span>CAD</span>
            </span>
          </label>
          {otherConfirmed !== null && (
            <p className="form-hint">
              {money(bill.total - otherConfirmed)} remains after the other
              confirmed shares.
            </p>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <Button type="submit">
            Confirm my share
            <Icon name="check" size={18} />
          </Button>
        </form>
      ) : (
        <p className="detail-note">
          <Icon
            name={bill.status === "pending" ? "clock" : "check"}
            size={18}
          />
          {!isParticipant
            ? "You're a group member, but you're not a participant in this bill. No share is needed from you."
            : bill.status === "settled"
              ? "Settled and saved. A little piece of shared history."
              : bill.status === "pending"
                ? "Your share is saved. The bill stays open until everyone's shares are confirmed and match the total."
                : "Everyone has confirmed. This bill is ready for settlement."}
        </p>
      )}
    </div>
  );
}
export default function Dialogs(props: Props) {
  const { modal, data, close, open } = props;
  if (modal.kind === "addBill")
    return (
      <Dialog title="A good thing, shared." close={close}>
        <BillForm data={data} groupId={modal.groupId} onSave={props.addBill} />
      </Dialog>
    );
  if (modal.kind === "newGroup")
    return (
      <Dialog title="Bring your people together." close={close}>
        <GroupForm onSave={props.addGroup} />
      </Dialog>
    );
  if (modal.kind === "bill") {
    const bill = data.bills.find((b) => b.id === modal.id);
    const group = data.groups.find((g) => g.id === bill?.groupId);
    return bill && group ? (
      <Dialog title={bill.title} close={close} kicker="THE LITTLE DETAILS">
        <BillDetail bill={bill} group={group} confirm={props.confirmShare} />
      </Dialog>
    ) : null;
  }
  if (modal.kind === "group") {
    const group = data.groups.find((g) => g.id === modal.id)!;
    const bills = data.bills.filter((b) => b.groupId === group.id);
    const summary = balances(bills);
    return (
      <Dialog title={group.name} close={close} kicker="YOUR SHARED SPACE">
        <div className="group-detail">
          <p className="dialog-intro">{group.description}</p>
          <div className="group-members">
            {group.members.map((n) => (
              <span key={n}>
                <Avatar name={n} />
                <small>{n === "Simon" ? "You" : n}</small>
              </span>
            ))}
          </div>
          <div className="group-net">
            <span>
              {summary.net >= 0 ? "You're owed overall" : "You owe overall"}
              <small>Complete bills only</small>
            </span>
            <strong>{money(Math.abs(summary.net))}</strong>
          </div>
          <BillList
            bills={bills}
            groups={data.groups}
            onBill={(bill) => open({ kind: "bill", id: bill.id })}
          />
          <Button onClick={() => open({ kind: "addBill", groupId: group.id })}>
            <Icon name="plus" size={18} />
            Add a bill to this group
          </Button>
        </div>
      </Dialog>
    );
  }
  if (modal.kind === "attention") {
    const pending = data.bills.filter(needsMyShare);
    return (
      <Dialog
        title="A moment to catch up."
        close={close}
        kicker="THINGS FOR YOU"
      >
        <BillList
          bills={pending}
          groups={data.groups}
          onBill={(b) => open({ kind: "bill", id: b.id })}
        />
        {!data.received && (
          <button
            className="repayment-prompt"
            onClick={() => open({ kind: "receive" })}
          >
            <Avatar name="Jamie" />
            <span>
              <strong>Jamie → You</strong>
              <small>Confirm an incoming repayment · $24.50</small>
            </span>
            <Icon name="arrow" size={18} />
          </button>
        )}
      </Dialog>
    );
  }
  if (modal.kind === "receive")
    return (
      <Dialog
        title="Did the money arrive?"
        kicker="CONFIRM REPAYMENT"
        close={close}
      >
        <div className="repayment-people">
          <div>
            <Avatar name="Jamie" />
            <strong>Jamie</strong>
          </div>
          <Icon name="arrow" size={26} />
          <div>
            <Avatar name="Simon" />
            <strong>You</strong>
          </div>
        </div>
        <div className="repayment-total">
          $24.50<span>CAD · Weekend people</span>
        </div>
        <p className="dialog-intro">
          Only confirm after you've received the full amount from Jamie.
          ShareTally records the repayment; your money travels outside the app.
        </p>
        <Button className="full-button" onClick={props.receive}>
          <Icon name="check" size={18} />
          Yes, I received $24.50
        </Button>
      </Dialog>
    );
  return (
    <Dialog title="Your demo, your way." kicker="DEMO SETTINGS" close={close}>
      <div className="settings-content">
        <div className="settings-profile">
          <Avatar name="Simon" />
          <div>
            <strong>Simon</strong>
            <p>Demo account · CAD</p>
          </div>
        </div>
        <p>
          All three designs share the same data in this browser. Bills, groups,
          and confirmations stay here when you refresh.
        </p>
        <p>
          No account or backend connection is needed. The original sign-in
          screen is still available at <a href="/auth">/auth</a>.
        </p>
        <details className="reset-settings">
          <summary>Reset demo data</summary>
          <p>
            This removes the bills and groups you've added in this browser and
            restores the sample records in all three designs.
          </p>
          <Button variant="secondary" onClick={props.reset}>
            Restore sample data
          </Button>
        </details>
      </div>
    </Dialog>
  );
}

import { useEffect, useRef, useState } from "react";
import {
  useBillApi,
  BillApiError,
  money,
  parseMoney,
  localToday,
  type Bill,
  type BillApi,
  type BillDraft,
  type Summary,
} from "./bill-api";
import { useGroupApi, errorMessage, type GroupDetail } from "./group-api";
import { Avatar, Button } from "./ui";
import Dialog from "./Dialog";
import { GroupDetails } from "./GroupDetails";
import "./bills.css";

export function Balance({
  summary,
  group = false,
}: {
  summary: Summary;
  group?: boolean;
}) {
  return (
    <section className="balance-card">
      <span className="eyebrow">
        {group ? "IN THIS GROUP" : "ACROSS YOUR GROUPS"} · CAD
      </span>
      <h2>{summary.netCents < 0 ? "You owe, net" : "You are owed, net"}</h2>
      <strong className="balance-number">
        {money(Math.abs(summary.netCents))}
      </strong>
      <div className="balance-breakdown">
        <span>
          You are owed <b>{money(summary.receivableCents)}</b>
        </span>
        <span>
          You owe <b>{money(summary.payableCents)}</b>
        </span>
      </div>
      <p>
        Complete, unsettled bills only.
        {!group && " Repayments are worked out within each group."}
      </p>
    </section>
  );
}
export function OverviewBalance({ revision }: { revision: string }) {
  const api = useBillApi();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    api
      .summary(controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) {
          setSummary(result.summary);
          setError("");
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(errorMessage(error));
      });
    return () => controller.abort();
  }, [api, revision, retry]);
  if (error)
    return (
      <div role="alert">
        <p>{error}</p>
        <Button onClick={() => setRetry((n) => n + 1)}>Retry balances</Button>
      </div>
    );
  return summary ? (
    <Balance summary={summary} />
  ) : (
    <p role="status">Loading balances...</p>
  );
}
export function GroupBills({ id, onSummary }: { id: string; onSummary: (id: string, summary: Summary | null) => void }) {
  const [membersOpen, setMembersOpen] = useState(false);
  const api = useBillApi();
  const groups = useGroupApi();
  const [data, setData] = useState<{
    bills: Bill[];
    summary: Summary;
    group: GroupDetail;
  } | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      api.list(id, controller.signal),
      groups.detail(id, controller.signal),
    ])
      .then(([bills, group]) => {
        if (!controller.signal.aborted) {
          setData({ ...bills, ...group });
          onSummary(id, bills.summary);
          setError("");
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setError(errorMessage(error));
          onSummary(id, null);
        }
      });
    return () => controller.abort();
  }, [api, groups, id, revision, onSummary]);
  function closeMembers() {
    setMembersOpen(false);
    setRevision(n => n + 1);
  }
  return (
    <section className="bills-page">
      <div className="bill-heading">
        <h2>{data?.group.name ?? "Group bills"}</h2>
        <Button variant="text" onClick={() => setMembersOpen(true)}>Members & invites</Button>
        <Button onClick={() => setRevision((n) => n + 1)}>Refresh bills</Button>
      </div>
      {error ? (
        <div role="alert" className="form-error"><p>{error}</p><Button onClick={() => setRevision(n => n + 1)}>Retry group bills</Button></div>
      ) : !data ? (
        <p role="status">Loading bills...</p>
      ) : (
        <>
          <div className="workspace-balance"><Balance summary={data.summary} group /><Button onClick={() => setCreating(true)}>New bill</Button></div>
          <div className="bill-heading">
            <h2>
              Bills <small>{data.bills.length}</small>
            </h2>
          </div>
          {!data.bills.length && (
            <p>No bills yet. Record a purchase you paid for to get started.</p>
          )}
          <div className="bill-list">
            {data.bills.map((bill) => (
              <a
                key={bill.id}
                href={`#/bills/${bill.id}`}
                className="bill-list-row"
              >
                <div>
                  <strong>{bill.title}</strong>
                  <span>
                    {bill.purchaseDate} · {bill.confirmedCount}/
                    {bill.participants.length} confirmed
                  </span>
                </div>
                <div>
                  <b>{money(bill.totalCents)}</b>
                  <span>{bill.completedAt ? "Complete" : "In progress"}</span>
                </div>
              </a>
            ))}
          </div>
          {creating && (
            <CreateBill
              group={data.group}
              api={api}
              close={() => setCreating(false)}
              created={(bill) => {
                window.location.hash = `/bills/${bill.id}`;
              }}
            />
          )}
        </>
      )}
      {membersOpen && <GroupDetails id={id} api={groups} close={closeMembers} onViewBills={closeMembers} />}
    </section>
  );
}
function CreateBill({
  group,
  api,
  close,
  created,
}: {
  group: GroupDetail;
  api: BillApi;
  close: () => void;
  created: (bill: Bill) => void;
}) {
  const me = group.members.find((member) => member.isCurrentUser)!;
  const storageKey = `bill-creation:${me.id}:${group.id}`;
  const [request, setRequest] = useState<BillDraft | null>(() => {
    try {
      const saved = sessionStorage.getItem(storageKey);
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });
  const [selected, setSelected] = useState(request?.participantIds ?? [me.id]);
  const [title, setTitle] = useState(request?.title ?? "");
  const [date, setDate] = useState(request?.purchaseDate ?? localToday());
  const [total, setTotal] = useState(
    request ? (request.totalCents / 100).toFixed(2) : "",
  );
  const [share, setShare] = useState(
    request ? (request.ownShareCents / 100).toFixed(2) : "",
  );
  const [notes, setNotes] = useState(request?.notes ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // Keep the exact request after an uncertain response. Retry cannot create another bill.
  const pending = useRef(false);
  async function submit() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const draft = request ?? {
        requestId: crypto.randomUUID(),
        title,
        purchaseDate: date,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        notes,
        totalCents: parseMoney(total),
        ownShareCents: parseMoney(share),
        participantIds: selected,
      };
      if (
        !draft.title.trim() ||
        draft.totalCents <= 0 ||
        draft.ownShareCents > draft.totalCents
      )
        throw new Error(
          "Enter a title, a positive total, and your share between zero and the total.",
        );
      sessionStorage.setItem(storageKey, JSON.stringify(draft));
      setRequest(draft);
      const { bill } = await api.create(group.id, draft);
      sessionStorage.removeItem(storageKey);
      created(bill);
    } catch (error) {
      if (
        error instanceof BillApiError &&
        [400, 403, 404].includes(error.status)
      ) {
        sessionStorage.removeItem(storageKey);
        setRequest(null);
      }
      setError(errorMessage(error));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <Dialog
      title="New bill"
      kicker={group.name}
      close={() => {
        if (!pending.current) close();
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        className="bill-form"
      >
        <fieldset disabled={busy || request !== null}>
          <fieldset>
            <legend>Who shared this purchase?</legend>
            <p>You are included as the initiator. Select the other participants.</p>
            <div className="participant-actions">
              <Button variant="text" onClick={() => setSelected(group.members.map(member => member.id))}>Select everyone</Button>
              <Button variant="text" onClick={() => setSelected([me.id])}>Just me</Button>
            </div>
            {group.members.map((member) => (
              <label className="participant-choice" key={member.id}>
                <input
                  type="checkbox"
                  checked={selected.includes(member.id)}
                  disabled={member.isCurrentUser}
                  onChange={(e) =>
                    setSelected((ids) =>
                      e.target.checked
                        ? [...ids, member.id]
                        : ids.filter((id) => id !== member.id),
                    )
                  }
                />
                {member.displayName}
                {member.isCurrentUser && " · You, initiator"}
              </label>
            ))}
            <p>{selected.length} participants selected · {group.members.length} group members</p>
          </fieldset>
          <label>
            Bill title
            <input
              required
              maxLength={120}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label>
            Purchase date
            <input
              required
              type="date"
              max={localToday()}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          <div className="bill-money-fields">
            <label>
              Bill total · CAD
              <input
                required
                inputMode="decimal"
                value={total}
                onChange={(e) => setTotal(e.target.value)}
              />
            </label>
            <label>
              My share · CAD
              <input
                required
                inputMode="decimal"
                value={share}
                onChange={(e) => setShare(e.target.value)}
              />
            </label>
          </div>
          <label>
            Notes · optional
            <textarea
              maxLength={2000}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </label>

        </fieldset>
        <p>
          Creating this bill confirms your share. Once everyone confirms, up to
          $0.05 may be added to or deducted from your cost. Saved bills cannot
          be edited yet.
        </p>
        {error && (
          <p role="alert" className="form-error">
            {error}
            {request &&
              " Retry sends the same bill details. You can close this form and return to retry."}
          </p>
        )}
        <div className="dialog-actions">
          <Button type="submit" disabled={busy}>
            {busy
              ? "Saving..."
              : request
                ? "Retry creation"
                : "Create bill and confirm my share"}
          </Button>
          {!request && (
            <Button variant="secondary" onClick={close} disabled={busy}>
              Cancel
            </Button>
          )}
        </div>
      </form>
    </Dialog>
  );
}
export function BillDetails({ id }: { id: string }) {
  const api = useBillApi();
  const [bill, setBill] = useState<Bill | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    api
      .detail(id, controller.signal)
      .then(({ bill }) => {
        if (!controller.signal.aborted) {
          setBill(bill);
          setError("");
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(errorMessage(error));
      });
    return () => controller.abort();
  }, [api, id, revision]);
  if (error)
    return (
      <div role="alert">
        <p>{error}</p>
        <Button onClick={() => setRevision((n) => n + 1)}>Retry bill</Button>
        <a href="#">Back to overview</a>
      </div>
    );
  if (!bill) return <p role="status">Loading bill...</p>;
  const initiator = bill.participants.find(
    (p) => p.userId === bill.initiatorId,
  )!;
  const own = bill.participants.find((p) => p.isCurrentUser);
  return (
    <section className="bills-page">
      <a href={`#/group-bills/${bill.groupId}`}>← Group bills</a>
      <div className="bill-heading">
        <div>
          <h1 ref={heading} tabIndex={-1}>
            {bill.title}
          </h1>
          <p>
            {bill.purchaseDate} · Paid by {initiator.displayName} · CAD
          </p>
        </div>
        <Button variant="secondary" onClick={() => setRevision((n) => n + 1)}>
          Refresh bill
        </Button>
      </div>
      <div className="bill-layout">
        <section className="difference-card">
          <span className="bill-status">
            {bill.completedAt ? "✓ COMPLETE" : "IN PROGRESS"}
          </span>
          <h2>
            {bill.differenceCents > 0
              ? "Left to match"
              : bill.differenceCents < 0
                ? "Over the total"
                : "Exact match"}
          </h2>
          <strong className="difference-number">
            {money(Math.abs(bill.differenceCents))}
          </strong>
          <p>
            {bill.confirmedCount}/{bill.participants.length} confirmed
            {bill.confirmedCount < bill.participants.length &&
              " · Everyone must confirm"}
          </p>
          <dl>
            <div>
              <dt>Bill total</dt>
              <dd>{money(bill.totalCents)}</dd>
            </div>
            <div>
              <dt>Submitted shares</dt>
              <dd>{money(bill.submittedCents)}</dd>
            </div>
          </dl>
        </section>
        <section className="bill-people">
          <h2>Everyone's share</h2>
          {bill.participants.map((p) => (
            <div className="bill-person" key={p.userId}>
              <Avatar name={p.displayName} />
              <div>
                <b>
                  {p.displayName}
                  {p.isCurrentUser && " · You"}
                </b>
                <span>
                  {p.userId === bill.initiatorId ? "Initiator · " : ""}
                  {p.confirmedAt ? "Confirmed" : "Awaiting confirmation"}
                </span>
              </div>
              <strong>
                {p.amountCents === null
                  ? "Not submitted"
                  : money(p.amountCents)}
              </strong>
            </div>
          ))}
        </section>
        <div className="bill-adjustment">
          {bill.completedAt ? (
            <>
              <h3>
                {bill.adjustmentCents === 0
                  ? "Everything matches."
                  : "Small difference assigned to the initiator."}
              </h3>
              <p>
                {initiator.displayName}: {money(initiator.amountCents!)}{" "}
                submitted {bill.adjustmentCents! < 0 ? "−" : "+"}{" "}
                {money(Math.abs(bill.adjustmentCents!))} adjustment ={" "}
                <b>
                  {money(initiator.amountCents! + bill.adjustmentCents!)}{" "}
                  effective cost
                </b>
                .
              </p>
            </>
          ) : (
            <>
              <h3>
                {bill.confirmedCount < bill.participants.length
                  ? "Waiting for everyone to confirm."
                  : "This bill cannot complete yet."}
              </h3>
              <p>
                {bill.confirmedCount < bill.participants.length
                  ? "Up to five cents can be assigned to the initiator after everyone confirms."
                  : Math.abs(bill.differenceCents) > 5
                    ? "The difference exceeds $0.05. Submitted shares are preserved; editing is not available yet."
                    : "The adjustment would make the initiator’s cost negative. Submitted shares are preserved; editing is not available yet."}
              </p>
            </>
          )}
        </div>
      </div>
      {bill.notes && (
        <section className="bill-notes">
          <h2>Purchase notes</h2>
          <p>{bill.notes}</p>
        </section>
      )}
      {own?.amountCents === null && (
        <SubmitShare
          key={id}
          bill={bill}
          api={api}
          saved={(updated) => {
            setBill(updated);
            heading.current?.focus();
          }}
        />
      )}
      {!own && (
        <p>
          You can view this bill as a group member. Only its participants can
          submit shares.
        </p>
      )}
    </section>
  );
}
function SubmitShare({
  bill,
  api,
  saved,
}: {
  bill: Bill;
  api: BillApi;
  saved: (bill: Bill) => void;
}) {
  const [amount, setAmount] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [attempt, setAttempt] = useState<number | null>(null);
  return (
    <form
      className="share-form"
      onSubmit={async (event) => {
        event.preventDefault();
        if (pending.current) return;
        pending.current = true;
        setBusy(true);
        setError("");
        try {
          const value = attempt ?? parseMoney(amount);
          if (value > bill.totalCents)
            throw new Error("Your share cannot exceed the bill total.");
          setAttempt(value);
          saved((await api.submit(bill.id, value)).bill);
        } catch (error) {
          if (error instanceof BillApiError && error.status === 400)
            setAttempt(null);
          setError(errorMessage(error));
        } finally {
          pending.current = false;
          setBusy(false);
        }
      }}
    >
      <h2>Confirm your share</h2>
      <p>
        Include your tax, discounts, and rounding. Enter 0 if you have no cost.
      </p>
      <label>
        My share · CAD
        <input
          required
          inputMode="decimal"
          value={amount}
          disabled={busy || attempt !== null}
          onChange={(e) => setAmount(e.target.value)}
        />
      </label>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <Button type="submit" disabled={busy}>
        {busy
          ? "Confirming..."
          : attempt === null
            ? "Submit and confirm my share"
            : "Retry confirmation"}
      </Button>
    </form>
  );
}

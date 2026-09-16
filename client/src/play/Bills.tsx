import { Notification } from './Notification';
import { useCached, denied, useCachedRequest, hideProtectedQueries, AccessError } from './query-cache';
import { AnimatedMoney } from './AnimatedMoney';
import { useAuth } from '@clerk/react';
import { startGroupSync } from './group-sync';
import { Repayments } from './Repayments';
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
import { Avatar, Button, Icon } from "./ui";
import Dialog from "./Dialog";
import { GroupDetails } from "./GroupDetails";
import "./bills.css";
import { GroupBalances } from "./GroupBalances";
import { InitiatorActions, ShareActions } from "./BillActions";

import { NextTransfer } from './NextTransfer';

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
        {group ? <AnimatedMoney cents={summary.netCents} /> : money(Math.abs(summary.netCents))}
      </strong>
      {!group && <div className="balance-breakdown">
        <span>
          You are owed <b>{money(summary.receivableCents)}</b>
        </span>
        <span>
          You owe <b>{money(summary.payableCents)}</b>
        </span>
      </div>}
      <p>
        Completed bills and confirmed repayments.
        {!group && " Repayments are worked out within each group."}
      </p>
    </section>
  );
}
export function OverviewBalance({ revision }: { revision: string }) {
  const api = useBillApi();
  const query = useCached<{ summary: Summary }>('/summary');
  const [retry, setRetry] = useState(0);
  useEffect(() => { void api.summary().catch(() => {}); }, [api, revision, retry]);
  return <>
    {query.error && <Notification><p>{query.data ? "Couldn't refresh your balances." : errorMessage(query.error)}</p><Button onClick={() => setRetry(n => n + 1)}>Retry balances</Button></Notification>}
    {query.data ? <Balance summary={query.data.summary} /> : !query.error && <LoadingFinancials label="Loading balances" />}
  </>;
}

function LoadingFinancials({ label }: { label: string }) {
  return <div className="financial-skeleton" role="status" aria-label={label}>
    <div /><div /><div />
  </div>;
}
export function GroupBills({ id, selectedRepaymentId }: { id: string; selectedRepaymentId?: string }) {
  const [membersOpen, setMembersOpen] = useState(false);
  const repaymentHistory = useRef<HTMLDivElement>(null);
  const api = useBillApi();
  const groups = useGroupApi();
  const cache = useCachedRequest();
  const billsQuery = useCached<Awaited<ReturnType<typeof api.list>>>(`/groups/${id}/bills`);
  const groupQuery = useCached<{ group: GroupDetail }>(`/groups/${id}`);
  const accessError = [billsQuery.error, groupQuery.error].find(denied);
  const data = !accessError && billsQuery.data && groupQuery.data ? { ...billsQuery.data, ...groupQuery.data } : null;
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [creating, setCreating] = useState(false);
  const { getToken } = useAuth();
  useEffect(() => {
    const sync = startGroupSync({
      groupId: id, getToken,
      invalidateRead: () => {
        // A response begun before this notification must never replace newer state.
        void cache.cancelQueries({ queryKey: [`/groups/${id}/bills`], exact: true });
        void cache.cancelQueries({ queryKey: [`/groups/${id}`], exact: true });
      },
      accessDenied: status => hideProtectedQueries(cache, `/groups/${id}`, new AccessError(status, status === 401 ? 'Please sign in again.' : 'Group not found.')),
      read: async signal => {
        const [bills, group] = await Promise.all([api.list(id, signal), groups.detail(id, signal)]);
        return { ...bills, ...group };
      },
      apply: () => {},
      status: setError,
    });
    return () => sync.stop();
  }, [api, groups, getToken, id, revision, cache]);
  function closeMembers() {
    setMembersOpen(false);
    setRevision(n => n + 1);
  }
  return (
    <section className="bills-page">
      <div className="bill-heading group-heading">
        <div><span className="eyebrow">YOUR SHOPPING CIRCLE</span><h2>{data?.group.name ?? "Group bills"}</h2>
        {data && <p className="group-member-count">{data.group.memberCount} {data.group.memberCount === 1 ? 'member' : 'members'} · CAD</p>}</div>
        {data && <div className="group-actions">
          <Button variant="secondary" onClick={() => setMembersOpen(true)}><Icon name="people" /> Members & invites</Button>
          <Button onClick={() => setCreating(true)}><Icon name="plus" /> New bill</Button>
        </div>}
      </div>
      {!data && (error || accessError) && <Notification><p>{accessError ? errorMessage(accessError) : "Couldn't load this group."}</p><Button onClick={() => setRevision(n => n + 1)}>Try again</Button></Notification>}
      {!data ? (
        <LoadingFinancials label="Loading group" />
      ) : (
        <>
          <div className="workspace-balance">
            <div className="group-balance-overview"><Balance summary={data.summary} group />
              <div className="group-member-faces" aria-label={`${data.group.memberCount} group members`}>
                {data.group.members.slice(0, 5).map(member => <Avatar key={member.id} name={member.displayName} imageUrl={member.imageUrl} fallbackImageUrl={member.fallbackImageUrl} small />)}
                {data.group.memberCount > 5 && <span>+{data.group.memberCount - 5}</span>}
                <small>All in it together.</small>
              </div>
            </div>
            <NextTransfer ledger={data.ledger} group={data.group} viewRepayments={() => {
              repaymentHistory.current?.scrollIntoView({ block: 'start', behavior: 'instant' });
              repaymentHistory.current?.focus({ preventScroll: true });
            }} />
          </div>
          <div className="bill-heading">
            <h2>
              Shared purchases <small>{data.bills.length}</small>
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
                <span className="purchase-icon" aria-hidden="true"><Icon name="basket" /></span>
                <div className="purchase-description">
                  <strong>{bill.title}</strong>
                  <span>
                    {bill.purchaseDate} · {bill.confirmedCount}/
                    {bill.participants.length} confirmed
                  </span>
                </div>
                <div className="purchase-amount">
                  <b>{money(bill.totalCents)}</b>
                  <span>{bill.canceledAt ? "Canceled" : bill.completedAt ? "Complete" : "In progress"}</span>
                </div>
                <Icon name="diagonal" />
              </a>
            ))}
          </div>
          <p className="purchase-history-note"><Icon name="check" /> Completed purchases stay in your history.</p>
          <GroupBalances ledger={data.ledger} />
          <div ref={repaymentHistory} tabIndex={-1} className="repayment-history-anchor">
            <Repayments key={`${id}:${selectedRepaymentId ?? ""}`} selectedId={selectedRepaymentId} group={data.group} records={data.repayments} api={api} refresh={() => setRevision(n => n + 1)} />
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
      {membersOpen && <GroupDetails id={id} api={groups} close={closeMembers} />}
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
          $0.05 may be added to or deducted from your cost. Editing a saved bill will require everyone to confirm again.
        </p>
        {error && (
          <Notification>
            {error}
            {request &&
              " Retry sends the same bill details. You can close this form and return to retry."}
          </Notification>
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
  const [notice, setNotice] = useState("");
  const { getToken } = useAuth();
  const [savedVersion, setSavedVersion] = useState(0);
  const resetEditors = useRef(false);
  const live = useRef<ReturnType<typeof startGroupSync> | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    let sync: ReturnType<typeof startGroupSync> | undefined;
    // This lookup only identifies the group. Display comes from the read after ready.
    api.detail(id, controller.signal).then(({ bill: located }) => {
      if (controller.signal.aborted) return;
      sync = startGroupSync({
        groupId: located.groupId, getToken,
        read: signal => api.detail(id, signal),
        apply: ({ bill: latest }) => {
          setBill(latest);
          if (resetEditors.current) { resetEditors.current = false; setSavedVersion(n => n + 1); }
        },
        status: setError,
      });
      live.current = sync;
    }).catch(error => {
      if (!controller.signal.aborted) setError(errorMessage(error));
    });
    return () => { controller.abort(); sync?.stop(); live.current = null; };
  }, [api, getToken, id, revision]);
  if (!bill) return error ? <Notification title="Could not load this bill">{error}<Button onClick={() => setRevision(n => n + 1)}>Retry bill</Button></Notification> : <div role="status">Loading bill...</div>;
  const initiator = bill.participants.find(
    (p) => p.userId === bill.initiatorId,
  )!;
  const own = bill.participants.find((p) => p.isCurrentUser);
  const needsAmountCorrection = !bill.completedAt && !bill.canceledAt &&
    Math.abs(bill.differenceCents) > 5 &&
    (bill.differenceCents < 0 || bill.participants.every(p => p.amountCents !== null));
  function saved(updated: Bill) {
    resetEditors.current = true;
    live.current?.retry();
    setNotice(
      updated.canceledAt
        ? "Bill canceled. The record is retained."
        : updated.completedAt
          ? "Everyone confirmed. The bill completed automatically."
          : updated.revision !== bill!.revision
            ? updated.participants.some((p) => p.isCurrentUser && p.confirmedAt)
              ? updated.participants.length > 1
                ? "Your share is confirmed. Other participants need to confirm again."
                : "Your share is confirmed."
              : "Amounts retained. Everyone needs to confirm again."
            : "Your share is confirmed.",
    );
    heading.current?.focus();
  }
  function refresh() {
    setNotice("");
    setRevision((n) => n + 1);
  }

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

      </div>
      {error && <Notification><p>{error}</p><Button onClick={refresh}>Retry bill</Button></Notification>}
      {notice && !needsAmountCorrection && <Notification tone="success" title="Bill updated" onDismiss={() => setNotice("")}>{notice}</Notification>}
      {needsAmountCorrection && (
        <Notification tone="warning" title={`Shares are ${money(Math.abs(bill.differenceCents))} ${bill.differenceCents < 0 ? "over" : "under"} the total`}>
          <p>
            This bill cannot complete yet. Check your amount and correct it if needed. The combined shares must
            be within $0.05 of the bill total.
          </p>
          <p>
            Changing a saved amount requires everyone to confirm again.
            The initiator’s new amount is confirmed when saved.
            Confirming unchanged amounts will not fix the difference.
          </p>
          {own && (
            <Button variant="secondary" onClick={() => document.getElementById("my-share-amount")?.focus()}>
              Edit my share
            </Button>
          )}
        </Notification>
      )}
      <div className="bill-layout">
        <section
          className={`difference-card${bill.canceledAt ? " canceled-bill" : ""}`}
        >
          <span className="bill-status">
            {bill.canceledAt
              ? "CANCELED"
              : bill.completedAt
                ? "✓ COMPLETE"
                : needsAmountCorrection
                  ? "SHARES NEED CORRECTION"
                  : "IN PROGRESS"}
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
              <Avatar name={p.displayName} imageUrl={p.imageUrl} fallbackImageUrl={p.fallbackImageUrl} />
              <div>
                <b>
                  {p.displayName}
                  {p.isCurrentUser && " · You"}
                </b>
                <span>
                  {p.userId === bill.initiatorId ? "Initiator · " : ""}
                  {bill.canceledAt
                    ? "Bill canceled"
                    : p.confirmedAt
                      ? "Confirmed"
                      : "Awaiting confirmation"}
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
        {!needsAmountCorrection && <div className={`bill-adjustment${!bill.completedAt && !bill.canceledAt ? " bill-adjustment-pending" : ""}`}>
          {bill.canceledAt ? (
            <>
              <h3>This bill was canceled.</h3>
              <p>
                Kept for reference and excluded from financial totals. Shares
                can no longer be submitted or confirmed.
              </p>
            </>
          ) : bill.completedAt ? (
            <>
              <p>Completed bills are final. Details, participants, and shares can no longer be changed.</p>
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
            <Notification
              tone={bill.confirmedCount < bill.participants.length ? "info" : "warning"}
              title={bill.confirmedCount < bill.participants.length ? "Waiting for everyone to confirm." : "This bill cannot complete yet."}
            >
              <p>
                {bill.confirmedCount < bill.participants.length
                  ? "Up to five cents can be assigned to the initiator after everyone confirms."
                  : Math.abs(bill.differenceCents) > 5
                    ? "The difference exceeds $0.05. Participants can correct their own amounts below."
                    : "The adjustment would make the initiator’s cost negative. Participants can correct their own amounts below."}
              </p>
            </Notification>
          )}
        </div>}
      </div>
      {bill.notes && (
        <section className="bill-notes">
          <h2>Purchase notes</h2>
          <p>{bill.notes}</p>
        </section>
      )}
      <div className="bill-action-layout">
        <ShareActions
          key={`share:${bill.id}:${savedVersion}`}
          bill={bill} api={api} saved={saved} refresh={refresh}
        />
        {own?.userId === bill.initiatorId && (
          <InitiatorActions
            key={`initiator:${bill.id}:${savedVersion}`}
            bill={bill} api={api} saved={saved} refresh={refresh}
          />
        )}
      </div>
      {!own && (
        <p>
          You can view this bill as a group member. Only its participants can
          submit shares.
        </p>
      )}
    </section>
  );
}

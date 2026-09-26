import { ReceiptDrafts } from './ReceiptDraft';
import { ItemClaims } from './ItemClaims';
import { Notification } from './Notification';
import { useCached, denied, useCachedRequest, hideProtectedQueries, AccessError } from './query-cache';
import { AnimatedMoney } from './AnimatedMoney';
import { useAuth } from '@clerk/react';
import { startGroupSync } from './group-sync';
import { Repayments } from './Repayments';
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  useBillApi,
  money,
  type Bill,
  type Summary,
} from "./bill-api";
import { useGroupApi, errorMessage, type GroupDetail } from "./group-api";
import { Avatar, Button, Icon } from "./ui";
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
// `title` renders the heading for the group, which is undefined until the group page loads.
export function GroupBills({ id, selectedRepaymentId, onDeleted, title }: {
  id: string;
  selectedRepaymentId?: string;
  onDeleted: () => void;
  title: (group: GroupDetail | undefined) => ReactNode;
}) {
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
        <div><span className="eyebrow">YOUR SHOPPING CIRCLE</span>{title(data?.group)}
        {data && <p className="group-member-count">{data.group.memberCount} {data.group.memberCount === 1 ? 'member' : 'members'} · CAD</p>}</div>
        {data && <div className="group-actions">
          <Button variant="secondary" onClick={() => setMembersOpen(true)}><Icon name="people" /> Members & invites</Button>
          <Button onClick={() => { window.location.hash = `/new-bill/${id}`; }}><Icon name="plus" /> New bill</Button>
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
          <ReceiptDrafts key={`${id}:${revision}`} groupId={id} open={draftId => { window.location.hash = `/new-bill/${id}/${draftId}`; }} />
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

        </>
      )}
      {membersOpen && <GroupDetails id={id} api={groups} close={closeMembers} onDeleted={onDeleted} />}
    </section>
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
  const adjustmentWouldBeNegative = initiator.amountCents !== null &&
    initiator.amountCents + bill.differenceCents < 0;
  const needsAmountCorrection = bill.mode !== 'items' && !bill.completedAt && !bill.canceledAt &&
    ((Math.abs(bill.differenceCents) > 5 &&
      (bill.differenceCents < 0 || bill.participants.every(p => p.amountCents !== null))) ||
      (adjustmentWouldBeNegative && bill.confirmedCount === bill.participants.length));
  function saved(updated: Bill) {
    setBill(updated);
    resetEditors.current = true;
    live.current?.retry();
    setNotice(
      updated.canceledAt
        ? "Bill canceled. The record is retained."
        : updated.completedAt
          ? "Everyone confirmed. The bill completed automatically."
          : updated.mode === 'items' ? 'Saved. Item confirmations and reservations are shown below.' : updated.revision !== bill!.revision
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
            {adjustmentWouldBeNegative && " The difference would reduce the initiator’s final cost below $0.00, so the shares need correcting even within that tolerance."}
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
            {bill.mode === 'items' ? "Initiator adjustment" : bill.differenceCents > 0
              ? "Left to match"
              : bill.differenceCents < 0
                ? "Over the total"
                : "Exact match"}
          </h2>
          <strong className="difference-number">
            {money(bill.mode === 'items' ? bill.differenceCents : Math.abs(bill.differenceCents))}
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
                  : "Difference assigned to the initiator."}
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
              {bill.mode === 'items' && <p>Based on current confirmed claims: {initiator.displayName}'s effective cost is {money((initiator.amountCents ?? 0) + bill.differenceCents)}. {(initiator.amountCents ?? 0) + bill.differenceCents < 0 && 'This is negative. The initiator must correct item prices or the paid total, then obtain the required confirmations.'}</p>}
              <p>
                {bill.mode === 'items' ? 'Every item must be fully claimed and confirmed, and everyone must respond. The difference goes to the initiator; a negative effective cost prevents completion.' : bill.confirmedCount < bill.participants.length
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
        {bill.mode === 'items' ? <ItemClaims key={`items:${bill.id}`} bill={bill} saved={saved} refresh={refresh} /> : <ShareActions
          key={`share:${bill.id}:${savedVersion}`}
          bill={bill} api={api} saved={saved} refresh={refresh}
        />}
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

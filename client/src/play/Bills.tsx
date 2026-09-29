import { ReceiptDrafts } from './ReceiptDraft';
import { ItemClaims } from './ItemClaims';
import { Notification } from './Notification';
import { useCached, denied, useCachedRequest, hideProtectedQueries, AccessError } from './query-cache';
import { useAuth } from '@clerk/react';
import { startGroupSync } from './group-sync';
import { GroupPage } from './GroupPage';
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  useBillApi,
  money,
  type Bill,
} from "./bill-api";
import { useGroupApi, errorMessage, type GroupDetail } from "./group-api";
import { Avatar, Button, Icon } from "./ui";
import { GroupDetails } from "./GroupDetails";
import "./group-workspace.css";
import "./bills.css";
import { InitiatorActions, ShareActions } from "./BillActions";
import { BillVariantSwitch, useBillVariant } from "./bill-variants.prototype";

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
      apply: () => {
        // Ready/changed events also cover another member's actions and receipt
        // processing finishing after the original upload response.
        void cache.cancelQueries({ queryKey: ['/groups'], exact: true })
          .then(() => groups.list()).catch(() => {});
      },
      status: setError,
    });
    return () => sync.stop();
  }, [api, groups, getToken, id, revision, cache]);
  function closeMembers() {
    setMembersOpen(false);
    setRevision(n => n + 1);
  }
  return <>
    {data ? <GroupPage data={data} title={title(data.group)} api={api} selectedRepaymentId={selectedRepaymentId}
      openMembers={() => setMembersOpen(true)} refresh={() => setRevision(n => n + 1)}
      drafts={<ReceiptDrafts key={`${id}:${revision}`} groupId={id} open={draftId => { window.location.hash = `/new-bill/${id}/${draftId}`; }} />} />
      : <section className="group-page">
        <header className="group-page-heading"><div className="group-page-title">{title(undefined)}</div></header>
        {(error || accessError) && <Notification><p>{accessError ? errorMessage(accessError) : "Couldn't load this group."}</p><Button onClick={() => setRevision(n => n + 1)}>Try again</Button></Notification>}
        <LoadingFinancials label="Loading group" />
      </section>}
    {membersOpen && <GroupDetails id={id} api={groups} close={closeMembers} onDeleted={onDeleted} />}
  </>;
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
  const variant = useBillVariant(); // PROTOTYPE
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
  if (!bill) return error ? <Notification title="Could not load this bill"><p>{error}</p><Button onClick={() => setRevision(n => n + 1)}>Retry bill</Button></Notification> : <div role="status">Loading bill...</div>;
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

  const open = !bill.completedAt && !bill.canceledAt;
  const waiting = bill.participants.filter(p => !p.confirmedAt);
  const waitingFor = new Intl.ListFormat("en", { type: "conjunction" }).format(
    [...waiting.filter(p => p.isCurrentUser).map(() => "you"), ...waiting.filter(p => !p.isCurrentUser).map(p => p.displayName)]);
  const initiatorCost = (initiator.amountCents ?? 0) + bill.differenceCents;
  const [status, statusTone] = bill.canceledAt ? ["Canceled", "muted"]
    : bill.completedAt ? ["Complete", "done"]
      : needsAmountCorrection ? ["Needs correction", "warning"] : ["In progress", "open"];
  // The headline number is the difference still to resolve; an exact match has nothing to show.
  const [headline, tone, showNumber] = bill.mode === 'items' ? ["Initiator adjustment", "", true]
    : bill.completedAt ? bill.adjustmentCents ? ["Difference assigned to the initiator", "", true] : ["Shares matched the total", "match", false]
      : bill.differenceCents > 0 ? ["Left to match", "", true]
        : bill.differenceCents < 0 ? ["Over the total", "over", true] : ["Shares match the total", "match", false];

  const notices = <>
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
    {open && !needsAmountCorrection && bill.confirmedCount === bill.participants.length && (
      <Notification tone="warning" title="This bill cannot complete yet.">
        <p>
          {bill.mode === 'items' ? 'Every item must be fully claimed and confirmed. The difference goes to the initiator; a negative effective cost prevents completion.'
            : Math.abs(bill.differenceCents) > 5
              ? "The difference exceeds $0.05. Participants can correct their own amounts below."
              : "The adjustment would make the initiator’s cost negative. Participants can correct their own amounts below."}
        </p>
      </Notification>
    )}
  </>;
  const shareAction = bill.mode === 'items' ? <ItemClaims key={`items:${bill.id}`} bill={bill} saved={saved} refresh={refresh} /> : <ShareActions
    key={`share:${bill.id}:${savedVersion}`}
    bill={bill} api={api} saved={saved} refresh={refresh}
  />;
  const initiatorActions = own?.userId === bill.initiatorId ? <InitiatorActions
    key={`initiator:${bill.id}:${savedVersion}`}
    bill={bill} api={api} saved={saved} refresh={refresh}
  /> : null;

  const current = (
    <section className="bills-page">
      <header className="bill-heading">
        <a className="bill-back" href={`#/group-bills/${bill.groupId}`}><Icon name="left" size={16} />Group bills</a>
        <h1 ref={heading} tabIndex={-1}>
          {bill.title}
        </h1>
        <p className="bill-meta">
          <span className={`bill-status bill-status-${statusTone}`}>{status}</span>
          {bill.purchaseDate} · Paid by {initiator.displayName} · CAD
        </p>
      </header>
      {notices}
      <section className={`group-card difference-card${bill.canceledAt ? " canceled-bill" : ""}`} aria-label="Bill progress">
        <h2 className={`bill-difference${tone ? ` bill-difference-${tone}` : ""}`}>
          <span>{headline}{!showNumber && <span aria-hidden="true"> ✓</span>}</span>
          {showNumber && <strong className="difference-number">
            {money(bill.mode === 'items' ? bill.differenceCents : Math.abs(bill.completedAt ? bill.adjustmentCents! : bill.differenceCents))}
          </strong>}
        </h2>
        <div className="bill-progress">
          <p>
            {bill.confirmedCount}/{bill.participants.length} confirmed
            {open && bill.confirmedCount < bill.participants.length && " · Everyone must confirm"}
          </p>
          <span className="bill-progress-track" aria-hidden="true">
            <span style={{ width: `${(bill.confirmedCount / bill.participants.length) * 100}%` }} />
          </span>
        </div>
        <dl className="bill-totals">
          <div>
            <dt>Bill total</dt>
            <dd>{money(bill.totalCents)}</dd>
          </div>
          <div>
            <dt>Submitted shares</dt>
            <dd>{money(bill.submittedCents)}</dd>
          </div>
        </dl>
        {!needsAmountCorrection && <div className="bill-adjustment">
          {bill.canceledAt ? (
            <p className="bill-note"><Icon name="close" size={14} />
              This bill was canceled. It is kept for reference and excluded from financial totals.
              Shares can no longer be submitted or confirmed.
            </p>
          ) : bill.completedAt ? (
            <>
              {bill.adjustmentCents !== 0 && <p>
                {initiator.displayName}: {money(initiator.amountCents!)}{" "}
                submitted {bill.adjustmentCents! < 0 ? "−" : "+"}{" "}
                {money(Math.abs(bill.adjustmentCents!))} adjustment ={" "}
                <b>
                  {money(initiator.amountCents! + bill.adjustmentCents!)}{" "}
                  effective cost
                </b>
                .
              </p>}
              <p className="bill-note"><Icon name="check" size={14} />
                Completed bills are final. Details, participants, and shares can no longer be changed.
              </p>
            </>
          ) : (
            <>
              {bill.mode === 'items' && <p>
                Based on current confirmed claims, {initiator.displayName}'s effective cost is <b>{money(initiatorCost)}</b>.
                {initiatorCost < 0 && ' This is negative. The initiator must correct item prices or the paid total, then obtain the required confirmations.'}
              </p>}
              {waiting.length > 0 && <p className="bill-note"><Icon name="clock" size={14} />
                Waiting for {waitingFor} to confirm.{" "}
                {bill.mode === 'items' ? 'Every item must be fully claimed and confirmed, and everyone must respond.' : 'Up to five cents can be assigned to the initiator after everyone confirms.'}
              </p>}
            </>
          )}
        </div>}
      </section>
      <section aria-label="Everyone's share">
        <h2 className="group-section-heading">Everyone's share <span className="count">{bill.participants.length}</span></h2>
        <div className="group-card bill-people">
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
              <strong className={p.amountCents === null ? "bill-person-missing" : undefined}>
                {p.amountCents === null
                  ? "Not submitted"
                  : money(p.amountCents)}
              </strong>
            </div>
          ))}
        </div>
      </section>
      {bill.notes && (
        <section className="bill-notes" aria-label="Purchase notes">
          <h2 className="group-section-heading">Purchase notes</h2>
          <p className="group-card">{bill.notes}</p>
        </section>
      )}
      <div className="bill-action-layout">
        {shareAction}
        {initiatorActions}
      </div>
      {!own && (
        <p className="bill-viewer-note">
          You can view this bill as a group member. Only its participants can
          submit shares.
        </p>
      )}
    </section>
  );
  return <BillVariantSwitch variant={variant} current={current} props={{
    bill, initiator, own, headingRef: element => { heading.current = element; }, backHref: `#/group-bills/${bill.groupId}`,
    status: { label: status, tone: statusTone as "open" | "done" | "warning" | "muted" },
    needsAmountCorrection, waiting: [...waiting.filter(p => p.isCurrentUser), ...waiting.filter(p => !p.isCurrentUser)],
    initiatorCost, notices, shareAction, initiatorActions,
  }} />;
}

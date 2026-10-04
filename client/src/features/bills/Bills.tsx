import { useSyncSession } from '../../shared/api/SyncSession';
import { routes } from '../../shared/browser/paths';
import { leaveDeletedGroup } from '../../shared/browser/route';
import { useEffect, useRef, useState } from "react";
import { errorMessage } from "../../shared/api/error-message";
import { startGroupSync } from '../../shared/api/group-sync';
import { money } from "../../shared/money";
import { Notification } from '../../shared/ui/Notification';
import { Button } from "../../shared/ui/Button";
import { Icon } from "../../shared/ui/Icon";
import { ItemClaims } from './claims/ItemClaims';
import { useBillApi } from "./api";
import { useGroupApi } from '../groups/api';
import { type Bill } from "@share-tally/domain/contracts/bills";
import { InitiatorActions, ShareActions } from "./BillActions";
import { BillPanel, ShareTicket } from "./BillOverview";

export function BillDetails({ id }: { id: string }) {
  const api = useBillApi();
  const groups = useGroupApi();
  const [bill, setBill] = useState<Bill | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [notice, setNotice] = useState("");
  const session = useSyncSession();
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
        groupId: located.groupId, session,
        read: async signal => {
          try { return await api.detail(id, signal); }
          catch (error) {
            // A bill 404 alone does not establish group deletion. Check its
            // known group before stopping the reader and aborting the final frame.
            if (error instanceof Error && 'status' in error && error.status === 404)
              await groups.detail(located.groupId, signal);
            throw error;
          }
        },
        accessDenied: () => setBill(null),
        // The bill's authorized lookup establishes its group even when Home's
        // group metadata is unavailable to the global deletion listener.
        deleted: () => { setBill(null); leaveDeletedGroup(); },
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
  }, [api, groups, session, id, revision]);
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
            ? updated.totalCents !== bill!.totalCents
              ? "Amounts retained. Everyone needs to confirm again."
              : "Bill details saved. Confirmations were kept."
            : updated.participants.length > 1
              ? "Your share is confirmed. Other participants’ confirmations are unchanged."
              : "Your share is confirmed.",
    );
    heading.current?.focus();
  }
  function refresh() {
    setNotice("");
    if (live.current) live.current.retry(); else setRevision((n) => n + 1);
  }

  const open = !bill.completedAt && !bill.canceledAt;
  const isInitiator = own?.userId === bill.initiatorId;
  const shareAction = bill.mode === 'items'
    ? <ItemClaims key={`items:${bill.id}`} bill={bill} saved={saved} refresh={refresh} />
    : <ShareActions key={`share:${bill.id}:${savedVersion}`} bill={bill} api={api} saved={saved} refresh={refresh} />;

  return (
    <section className={`bill-page${bill.canceledAt ? " bill-page-canceled" : ""}`}>
      <header className="bill-header">
        <a className="bill-back" href={routes.groupBills(bill.groupId)}><Icon name="left" size={16} />Group bills</a>
        <h1 ref={heading} tabIndex={-1}>
          {bill.title}
        </h1>
        <p className="bill-meta">
          {bill.purchaseDate}, paid by {isInitiator ? "you" : initiator.displayName}, in CAD
        </p>
      </header>
      <div className="bill-main">
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
              Saving a changed amount confirms it and keeps everyone else’s confirmation.
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
              {bill.mode === 'items'
                ? "Every item must be fully claimed and confirmed. The difference goes to the initiator; a negative effective cost prevents completion."
                : Math.abs(bill.differenceCents) > 5
                  ? "The difference exceeds $0.05. Participants can correct their own amounts below."
                  : "The adjustment would make the initiator’s cost negative. Participants can correct their own amounts below."}
            </p>
          </Notification>
        )}
        <ShareTicket bill={bill} own={own} needsAmountCorrection={needsAmountCorrection}>
          {bill.mode !== 'items' && shareAction}
        </ShareTicket>
        {bill.mode === 'items' && <div className="bill-claims">{shareAction}</div>}
      </div>
      {/* After the main column so focus and reading order follow the page;
          on mobile only the non-interactive summary strip is moved up by CSS. */}
      <BillPanel bill={bill} needsAmountCorrection={needsAmountCorrection} initiatorActions={isInitiator && (
        <InitiatorActions
          key={`initiator:${bill.id}:${savedVersion}`}
          bill={bill} api={api} saved={saved} refresh={refresh}
        />
      )} />
    </section>
  );
}

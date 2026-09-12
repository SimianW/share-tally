import { useEffect, useState } from "react";
import {
  balances,
  money,
  newDemoId,
  needsMyShare,
  readDemo,
  readTheme,
  seed,
  storageKey,
  today,
  type Bill,
  type DemoData,
  type Theme,
  type View,
} from "./data";
import {
  ActivityFeed,
  Avatar,
  BillList,
  Button,
  GroupCards,
  Icon,
  Logo,
  SectionHeading,
  type IconName,
} from "./ui";
import { GatherHome, OrbitHome, PlayHome } from "./Homepages";
import Dialogs, { type Modal, type NewBill, type NewGroup } from "./Dialogs";
import "./demo.css";
import "./themes.css";
import "./responsive.css";

const designs: { id: Theme; name: string; description: string }[] = [
  { id: "play", name: "Play", description: "圆润 · 青春 · 轻快" },
  { id: "gather", name: "Gather", description: "温暖 · 留白 · 生活感" },
  { id: "orbit", name: "Orbit", description: "深色 · 利落 · 高效" },
];
const navigation: { id: View; label: string; icon: IconName }[] = [
  { id: "overview", label: "Overview", icon: "grid" },
  { id: "groups", label: "My groups", icon: "people" },
  { id: "activity", label: "Activity", icon: "activity" },
  { id: "settlements", label: "Settlements", icon: "arrows" },
];
export default function DemoApp() {
  const [theme, setTheme] = useState(readTheme);
  const [view, setView] = useState<View>("overview");
  const [data, setData] = useState(readDemo);
  const [modal, setModal] = useState<Modal>(null);
  const [filter, setFilter] = useState("all");
  const [allBills, setAllBills] = useState(false);
  const [toast, setToast] = useState("");
  const [storageWarning, setStorageWarning] = useState(false);
  const pending = data.bills.filter(needsMyShare);
  const date = new Date()
    .toLocaleDateString("en-CA", {
      weekday: "long",
      month: "long",
      day: "numeric",
    })
    .toUpperCase();
  useEffect(() => {
    if (toast) {
      const timer = window.setTimeout(() => setToast(""), 4500);
      return () => window.clearTimeout(timer);
    }
  }, [toast]);
  useEffect(() => {
    const handler = () => setTheme(readTheme());
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, []);
  function save(next: DemoData, message: string) {
    setData(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
      setStorageWarning(false);
    } catch {
      setStorageWarning(true);
    }
    setToast(message);
    setModal(null);
  }
  function addBill(bill: NewBill) {
    const record: Bill = {
      ...bill,
      id: newDemoId(),
      initiator: "Simon",
      date: today(),
      status:
        bill.participants.length === 1 && bill.share === bill.total
          ? "complete"
          : "pending",
    };
    save(
      {
        ...data,
        bills: [record, ...data.bills],
        activity: [
          {
            id: newDemoId(),
            person: "Simon",
            text: "added a new bill",
            detail: `${bill.title} · ${money(bill.total)}`,
            date: today(),
          },
          ...data.activity,
        ],
      },
      "Bill added. Your share is confirmed.",
    );
  }
  function addGroup(group: NewGroup) {
    save(
      {
        ...data,
        groups: [
          ...data.groups,
          {
            ...group,
            id: newDemoId(),
            color:
              group.icon === "basket"
                ? "lime"
                : group.icon === "home"
                  ? "lavender"
                  : "peach",
            description: "A few good people, sharing the little things.",
          },
        ],
        activity: [
          {
            id: newDemoId(),
            person: "Simon",
            text: "created a group",
            detail: group.name,
            date: today(),
          },
          ...data.activity,
        ],
      },
      `${group.name} is ready for your people.`,
    );
    setView("groups");
  }
  function confirmShare(id: string, cents: number) {
    const bill = data.bills.find((b) => b.id === id)!;
    // Only this seeded bill has the other participants' confirmed fixture shares.
    const complete = id === "b1" && cents + 14040 === bill.total;
    save(
      {
        ...data,
        bills: data.bills.map((b) =>
          b.id === id
            ? { ...b, share: cents, status: complete ? "complete" : "pending" }
            : b,
        ),
        activity: [
          {
            id: newDemoId(),
            person: "Simon",
            text: "confirmed your share",
            detail: `${bill.title} · ${money(cents)}`,
            date: today(),
          },
          ...data.activity,
        ],
      },
      complete
        ? "Share confirmed. This bill is complete!"
        : "Your share is saved. This bill is still awaiting balanced, confirmed shares.",
    );
  }
  const changeTheme = (next: Theme) => {
    setTheme(next);
    const url = new URL(window.location.href);
    url.searchParams.set("design", next);
    window.history.replaceState({}, "", url);
    try {
      localStorage.setItem("sharetally.design", next);
    } catch {
      /* Keep the selected design in memory. */
    }
  };
  const navigate = (next: View) => {
    setView(next);
    setAllBills(false);
    setFilter("all");
    window.scrollTo({ top: 0, behavior: "instant" });
  };
  const openBill = (bill: Bill) => setModal({ kind: "bill", id: bill.id });
  const homeProps = {
    data,
    addBill: () => setModal({ kind: "addBill" }),
    newGroup: () => setModal({ kind: "newGroup" }),
    openGroup: (id: string) => setModal({ kind: "group", id }),
    openBill,
    settlements: () => navigate("settlements"),
    activity: () => navigate("activity"),
    attention: () => navigate("activity"),
  };
  const filteredBills =
    filter === "attention"
      ? pending
      : filter === "settled"
        ? data.bills.filter((b) => b.status === "settled")
        : data.bills;
  const billSection = (
    <section className="bills-section">
      <SectionHeading
        title={
          allBills
            ? "All bills"
            : theme === "gather"
              ? "The shared ledger"
              : "Recent bills"
        }
        action={allBills ? "Show recent" : "View all"}
        onAction={() => setAllBills(!allBills)}
      />
      <div className="bill-filters" aria-label="Filter bills">
        {[
          { id: "all", label: "All bills" },
          { id: "attention", label: "Needs attention" },
          { id: "settled", label: "Settled" },
        ].map((f) => (
          <button
            key={f.id}
            className={filter === f.id ? "selected" : ""}
            aria-pressed={filter === f.id}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
            {f.id === "attention" && <span>{pending.length}</span>}
          </button>
        ))}
        <span className="currency-label">CAD</span>
      </div>
      <BillList
        bills={allBills ? filteredBills : filteredBills.slice(0, 4)}
        groups={data.groups}
        onBill={openBill}
      />
    </section>
  );
  const nav = (
    <nav className="main-nav" aria-label="Main navigation">
      {navigation.map((n) => (
        <button
          key={n.id}
          className={view === n.id ? "active" : ""}
          aria-current={view === n.id ? "page" : undefined}
          onClick={() => navigate(n.id)}
        >
          <Icon name={n.icon} />
          <span>{n.label}</span>
          {n.id === "activity" && pending.length > 0 && (
            <span className="nav-count">{pending.length}</span>
          )}
        </button>
      ))}
    </nav>
  );
  return (
    <div className={`demo theme-${theme}`}>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <div className="design-bar">
        <div className="design-label">
          <span className="design-dot" />
          DESIGN STUDIO
          <span className="design-divider" />
          <span>Three ways to share.</span>
        </div>
        <nav className="design-switch" aria-label="Homepage designs">
          {designs.map((d, i) => (
            <button
              key={d.id}
              aria-pressed={theme === d.id}
              title={d.description}
              onClick={() => changeTheme(d.id)}
            >
              <span>0{i + 1}</span>
              {d.name}
            </button>
          ))}
        </nav>
        <button
          className="demo-label"
          aria-label="Demo settings"
          onClick={() => setModal({ kind: "settings" })}
        >
          LOCAL DEMO <Icon name="settings" size={14} />
        </button>
      </div>
      {storageWarning && (
        <div role="alert" className="storage-warning">
          Browser storage is unavailable. You can keep exploring, but changes
          will be lost on refresh.
        </div>
      )}
      {theme === "gather" && (
        <header className="gather-topbar">
          <button
            className="logo-button"
            onClick={() => navigate("overview")}
            aria-label="ShareTally home"
          >
            <Logo />
          </button>
          {nav}
          <button
            className="gather-profile"
            onClick={() => setModal({ kind: "settings" })}
          >
            <Avatar name="Simon" />
            <span>Simon</span>
            <Icon name="down" size={15} />
          </button>
        </header>
      )}
      <div className="app-shell">
        {theme !== "gather" && (
          <aside className="sidebar">
            <button
              className="logo-button"
              onClick={() => navigate("overview")}
              aria-label="ShareTally home"
            >
              <Logo compact={theme === "orbit"} />
            </button>
            <div className="workspace-label">YOUR LITTLE CORNER</div>
            {nav}
            <div className="sidebar-bottom">
              <div className="sidebar-note">
                <Icon name="heart" />
                <p>
                  More friendship.
                  <br />
                  Less “you owe me.”
                </p>
                <span>That's the whole idea.</span>
              </div>
              <button
                className="profile"
                onClick={() => setModal({ kind: "settings" })}
              >
                <Avatar name="Simon" />
                <span>
                  <strong>Simon</strong>
                  <small>Personal account</small>
                </span>
                <Icon name="down" size={16} />
              </button>
            </div>
          </aside>
        )}
        <main className="main-content" id="main-content" tabIndex={-1}>
          <header className="page-header">
            <div>
              <div className="eyebrow">
                {theme === "orbit" ? "PERSONAL WORKSPACE / " : ""}
                {date}
              </div>
              <h1>
                {view === "overview" ? (
                  theme === "play" ? (
                    <>
                      Hey Simon, <span>all good?</span>
                      <span className="greeting-spark">
                        <Icon name="spark" size={27} />
                      </span>
                    </>
                  ) : theme === "gather" ? (
                    <>
                      Life is better <em>shared.</em>
                    </>
                  ) : (
                    <>
                      Your money.
                      <span className="orbit-heading-muted"> In the loop.</span>
                    </>
                  )
                ) : (
                  navigation.find((n) => n.id === view)?.label
                )}
              </h1>
              <p>
                {view !== "overview"
                  ? view === "groups"
                    ? "Good people. Shared plans. Everything in one place."
                    : view === "activity"
                      ? "The latest from the people you share with."
                      : "A clear view of what’s owed and what’s received."
                  : theme === "play"
                    ? "A little less math. A little more living."
                    : theme === "gather"
                      ? "Welcome back, Simon. Pull up a chair."
                      : "Every shared expense, accounted for."}
              </p>
            </div>
            <div className="header-actions">
              <button
                className="icon-button notification-button"
                aria-label="View things to do"
                onClick={() => setModal({ kind: "attention" })}
              >
                <Icon name="bell" />
                {(pending.length > 0 || !data.received) && <i />}
              </button>
              <Button onClick={() => setModal({ kind: "addBill" })}>
                <Icon name="plus" />
                Add a bill
              </Button>
            </div>
          </header>
          <div key={theme + view} className="view-content">
            {view === "overview" &&
              (theme === "play" ? (
                <PlayHome {...homeProps} billSection={billSection} />
              ) : theme === "gather" ? (
                <GatherHome {...homeProps} billSection={billSection} />
              ) : (
                <OrbitHome {...homeProps} billSection={billSection} />
              ))}
            {view === "groups" && (
              <section className="standalone-section">
                <SectionHeading
                  title="Your people"
                  count={data.groups.length}
                  action="New group"
                  onAction={homeProps.newGroup}
                />
                <GroupCards
                  groups={data.groups}
                  bills={data.bills}
                  onGroup={homeProps.openGroup}
                  onCreate={homeProps.newGroup}
                />
              </section>
            )}
            {view === "activity" && (
              <div className="activity-page">
                <section className="standalone-section">
                  <SectionHeading
                    title="Waiting for you"
                    count={pending.length}
                  />
                  <BillList
                    bills={pending}
                    groups={data.groups}
                    onBill={openBill}
                  />
                </section>
                <section className="standalone-section">
                  <SectionHeading title="What's been happening" />
                  <ActivityFeed items={data.activity} full />
                </section>
              </div>
            )}
            {view === "settlements" && (
              <div className="settlements-page">
                <section className="standalone-section">
                  <SectionHeading title="Your group balances" />
                  <p className="section-description">
                    Complete bills count toward your balance. All shares need to
                    be confirmed before a group can settle.
                  </p>
                  {data.groups.map((g) => {
                    const bills = data.bills.filter((b) => b.groupId === g.id);
                    const summary = balances(bills);
                    const incomplete = bills.filter(
                      (b) => b.status === "pending",
                    ).length;
                    return (
                      <button
                        className="settlement-group"
                        key={g.id}
                        onClick={() => homeProps.openGroup(g.id)}
                      >
                        <span className={`bill-symbol ${g.color}`}>
                          <Icon name={g.icon} />
                        </span>
                        <span>
                          <strong>{g.name}</strong>
                          <small>
                            {incomplete
                              ? `${incomplete} ${incomplete === 1 ? "bill needs" : "bills need"} confirmed shares`
                              : bills.some((b) => b.status === "complete")
                                ? "Complete bills ready to review"
                                : "All clear"}
                          </small>
                        </span>
                        <span className="settlement-balance">
                          <strong>{money(Math.abs(summary.net))}</strong>
                          <small>
                            {summary.net >= 0 ? "you're owed" : "you owe"}
                          </small>
                        </span>
                        <Icon name="arrow" size={18} />
                      </button>
                    );
                  })}
                </section>
                <section className="incoming-card">
                  <span className="eyebrow">INCOMING REPAYMENT</span>
                  <div className="incoming-person">
                    <Avatar name="Jamie" />
                    <Icon name="arrow" />
                    <Avatar name="Simon" />
                  </div>
                  <h2>
                    {data.received
                      ? "All squared up."
                      : "Jamie sent you $24.50"}
                  </h2>
                  <p>
                    {data.received
                      ? "You confirmed this repayment. It’s saved in your activity."
                      : "Weekend people. Check that the money arrived, then confirm it here."}
                  </p>
                  <Button
                    variant="secondary"
                    onClick={() =>
                      data.received
                        ? navigate("activity")
                        : setModal({ kind: "receive" })
                    }
                  >
                    {data.received ? "View activity" : "Confirm received"}
                    <Icon name={data.received ? "arrow" : "check"} size={17} />
                  </Button>
                </section>
              </div>
            )}
          </div>
          <footer className="page-footer">
            <span>
              <Logo compact />
              Made for the people you share life with.
            </span>
            <span>
              All amounts in CAD <i /> A little better together
            </span>
          </footer>
        </main>
      </div>
      {theme === "gather" && <div className="gather-mobile-nav">{nav}</div>}
      {modal && (
        <Dialogs
          key={modal.kind + ("id" in modal ? modal.id : "")}
          modal={modal}
          data={data}
          close={() => setModal(null)}
          open={setModal}
          addBill={addBill}
          addGroup={addGroup}
          confirmShare={confirmShare}
          receive={() =>
            save(
              {
                ...data,
                received: true,
                activity: [
                  {
                    id: newDemoId(),
                    person: "Simon",
                    text: "confirmed a repayment",
                    detail: "Jamie → You · $24.50",
                    date: today(),
                  },
                  ...data.activity,
                ],
              },
              "Repayment confirmed. You and Jamie are squared up.",
            )
          }
          reset={() => {
            save(
              structuredClone(seed),
              "Sample data restored across all three designs.",
            );
            setView("overview");
            setFilter("all");
            setAllBills(false);
          }}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          <Icon name="check" size={19} />
          <span>{toast}</span>
          <button aria-label="Dismiss message" onClick={() => setToast("")}>
            <Icon name="close" size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

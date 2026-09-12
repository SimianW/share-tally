import type { ReactNode } from "react";
import {
  balances,
  money,
  needsMyShare,
  type Bill,
  type DemoData,
} from "./data";
import {
  ActivityFeed,
  Avatar,
  Avatars,
  BillList,
  Button,
  GroupCards,
  Icon,
  SectionHeading,
} from "./ui";

type HomeProps = {
  data: DemoData;
  addBill: () => void;
  newGroup: () => void;
  openGroup: (id: string) => void;
  openBill: (bill: Bill) => void;
  settlements: () => void;
  activity: () => void;
  attention: () => void;
};
export function AttentionCard({
  data,
  openBill,
  attention,
}: Pick<HomeProps, "data" | "openBill" | "attention">) {
  const pending = data.bills.filter(needsMyShare);
  const next = pending[0];
  return (
    <section className={`next-card ${!next ? "all-clear" : ""}`}>
      <div className="next-card-heading">
        <span className="next-icon">
          <Icon name={next ? "spark" : "check"} />
        </span>
        <span>YOUR NEXT MOVE</span>
        <span className="next-count">
          {String(pending.length).padStart(2, "0")}
        </span>
      </div>
      <h2>
        {next ? (
          <>
            A tiny to-do.
            <br />
            Then you're through.
          </>
        ) : (
          <>
            Nothing on your list.
            <br />
            Nice going.
          </>
        )}
      </h2>
      <p>
        {next ? (
          <>
            {next.initiator} added {next.title.toLowerCase()}.<br />
            Pop in and confirm your share.
          </>
        ) : (
          <>
            Your shares are all confirmed.
            <br />
            Time for the good stuff.
          </>
        )}
      </p>
      <Button
        variant="secondary"
        onClick={() => (next ? openBill(next) : attention())}
      >
        {next ? "Confirm my share" : "View activity"}
        <Icon name="arrow" size={18} />
      </Button>
    </section>
  );
}
export function RecentBills({
  data,
  openBill,
  all = false,
}: Pick<HomeProps, "data" | "openBill"> & { all?: boolean }) {
  return (
    <BillList
      bills={all ? data.bills : data.bills.slice(0, 4)}
      groups={data.groups}
      onBill={openBill}
    />
  );
}
export function PlayHome(props: HomeProps & { billSection: ReactNode }) {
  const { data, settlements, newGroup, openGroup, activity } = props;
  const summary = balances(data.bills);
  return (
    <>
      <div className="play-hero-grid">
        <section className="balance-hero">
          <div className="hero-kicker">
            <span className="live-dot" />
            THE BIG PICTURE
          </div>
          <div className="balance-hero-content">
            <div>
              <p className="balance-label">
                {summary.net >= 0
                  ? "You're looking good."
                  : "A little to square up."}
              </p>
              <div className="hero-amount">
                {money(Math.abs(summary.net))}
                <span>CAD</span>
              </div>
              <p className="balance-caption">
                {summary.net >= 0 ? "You're owed overall" : "You owe overall"}{" "}
                across all groups
              </p>
              <button className="hero-action" onClick={settlements}>
                Let's settle up <Icon name="arrow" size={18} />
              </button>
            </div>
            <div className="balance-slip">
              <span className="slip-mark">
                <Icon name="receipt" size={25} />
              </span>
              <div className="slip-row">
                <span>You're owed</span>
                <strong>{money(summary.owed)}</strong>
              </div>
              <div className="slip-row">
                <span>You owe</span>
                <strong>{money(summary.owing)}</strong>
              </div>
              <div className="slip-total">
                <span>
                  Good things,
                  <br />
                  <b>shared.</b>
                </span>
                <Icon name="heart" size={27} />
              </div>
            </div>
          </div>
          <span className="hero-footnote">
            <Icon name="check" size={14} />
            Complete bills only. Everyone on the same page.
          </span>
        </section>
        <AttentionCard {...props} />
      </div>
      <section className="groups-section">
        <SectionHeading
          title="Your people"
          count={data.groups.length}
          action="New group"
          onAction={newGroup}
        />
        <GroupCards
          groups={data.groups.slice(0, 3)}
          bills={data.bills}
          onGroup={openGroup}
        />
      </section>
      <div className="lower-grid">
        {props.billSection}
        <section className="activity-section">
          <SectionHeading
            title="A little update"
            action="All activity"
            onAction={activity}
          />
          <ActivityFeed items={data.activity} />
          <div className="activity-footer">
            <Icon name="heart" size={16} />
            Good friends keep things fair.
          </div>
        </section>
      </div>
    </>
  );
}
export function GatherHome(props: HomeProps & { billSection: ReactNode }) {
  const { data, settlements, newGroup, openGroup, activity } = props;
  const summary = balances(data.bills);
  return (
    <>
      <section className="gather-summary">
        <div className="gather-balance">
          <span className="eyebrow">YOUR SHARED BALANCE</span>
          <div>
            {money(Math.abs(summary.net))}
            <span>CAD</span>
          </div>
          <p>
            {summary.net >= 0
              ? "Coming back to you."
              : "A little to square up."}
          </p>
        </div>
        <div className="gather-balance-detail">
          <div>
            <span className="mini-arrow">
              <Icon name="diagonal" size={16} />
            </span>
            <p>
              You're owed<strong>{money(summary.owed)}</strong>
            </p>
          </div>
          <div>
            <span className="mini-arrow outward">
              <Icon name="diagonal" size={16} />
            </span>
            <p>
              You owe<strong>{money(summary.owing)}</strong>
            </p>
          </div>
          <small>From complete bills across your groups.</small>
        </div>
        <div className="gather-summary-action">
          <span className="gather-stamp" aria-hidden="true">
            <Icon name="heart" size={27} />
            <span>SHARED WITH CARE</span>
          </span>
          <Button onClick={settlements}>
            Settle up
            <Icon name="arrow" size={16} />
          </Button>
        </div>
      </section>
      <div className="gather-columns">
        <div>
          <section className="gather-groups">
            <SectionHeading
              title="The company you keep"
              action="Start a group"
              onAction={newGroup}
            />
            <GroupCards
              groups={data.groups.slice(0, 3)}
              bills={data.bills}
              onGroup={openGroup}
            />
          </section>
          {props.billSection}
        </div>
        <aside className="gather-aside">
          <AttentionCard {...props} />
          <section className="gather-activity">
            <SectionHeading
              title="Around the table"
              action="View all"
              onAction={activity}
            />
            <ActivityFeed items={data.activity} />
          </section>
          <div className="gather-note">
            <span>01 / A SHARED LIFE</span>
            <p>
              The little things
              <br />
              add up.
              <br />
              <em>So do the good ones.</em>
            </p>
            <Icon name="spark" size={32} />
          </div>
        </aside>
      </div>
    </>
  );
}
export function OrbitHome(props: HomeProps & { billSection: ReactNode }) {
  const { data, settlements, newGroup, openGroup, openBill, attention } = props;
  const summary = balances(data.bills);
  const complete = data.bills.filter((b) => b.status !== "pending").length;
  const progress = Math.round(
    (complete / Math.max(data.bills.length, 1)) * 100,
  );
  const pending = data.bills.filter(needsMyShare);
  return (
    <>
      <div className="orbit-metrics">
        <section className="orbit-net">
          <div className="eyebrow">
            <span className="live-dot" />
            NET POSITION <span className="metric-currency">CAD</span>
          </div>
          <div className="orbit-big-number">
            {summary.net >= 0 ? "+" : "−"}
            {money(Math.abs(summary.net))}
          </div>
          <div className="orbit-metric-bottom">
            <span>
              {summary.net >= 0 ? "Overall, you’re owed" : "Overall, you owe"}
            </span>
            <button onClick={settlements} aria-label="View settlements">
              <Icon name="diagonal" />
            </button>
          </div>
        </section>
        <section className="orbit-stat">
          <span className="metric-icon">
            <Icon name="diagonal" />
          </span>
          <span className="eyebrow">YOU'RE OWED</span>
          <strong>{money(summary.owed)}</strong>
          <span>Across {data.groups.length} groups</span>
        </section>
        <section className="orbit-stat">
          <span className="metric-icon owing">
            <Icon name="diagonal" />
          </span>
          <span className="eyebrow">YOU OWE</span>
          <strong>{money(summary.owing)}</strong>
          <span>From complete bills</span>
        </section>
        <section className="orbit-progress">
          <div className="progress-ring">
            <svg
              viewBox="0 0 100 100"
              aria-label={`${progress}% of bills confirmed or settled`}
              role="img"
            >
              <circle
                cx="50"
                cy="50"
                r="42"
                fill="none"
                stroke="var(--line)"
                strokeWidth="5"
              />
              <circle
                cx="50"
                cy="50"
                r="42"
                fill="none"
                stroke="var(--accent)"
                strokeWidth="5"
                strokeDasharray={`${progress * 2.639} 263.9`}
                transform="rotate(-90 50 50)"
                strokeLinecap="round"
              />
            </svg>
            <span>
              {complete}
              <small>/{data.bills.length}</small>
            </span>
          </div>
          <div>
            <strong>In good shape</strong>
            <span>
              Bills confirmed
              <br />
              or settled
            </span>
          </div>
        </section>
      </div>
      <section className="orbit-attention">
        <span className="attention-marker">
          <Icon name={pending.length ? "clock" : "check"} size={18} />
        </span>
        <div>
          <strong>
            {pending.length
              ? `${pending.length} ${pending.length === 1 ? "thing needs" : "things need"} your attention`
              : "You're all caught up"}
          </strong>
          <span>
            {pending.length
              ? `${pending[0].title} · ${pending[0].initiator} is waiting for your share`
              : "Your shares are confirmed. Keep the plans coming."}
          </span>
        </div>
        <Button
          variant="secondary"
          onClick={() => (pending[0] ? openBill(pending[0]) : attention())}
        >
          {pending.length ? "Review share" : "View activity"}
          <Icon name="arrow" size={16} />
        </Button>
      </section>
      <div className="orbit-content-grid">
        <div>
          {props.billSection}
          <section className="orbit-feed">
            <SectionHeading title="Live activity" />
            <ActivityFeed items={data.activity} />
          </section>
        </div>
        <aside className="orbit-groups">
          <SectionHeading
            title="Your circles"
            count={data.groups.length}
            action="Add"
            onAction={newGroup}
          />
          {data.groups.map((g, i) => {
            const b = balances(data.bills.filter((b) => b.groupId === g.id));
            return (
              <button
                key={g.id}
                className="orbit-group"
                onClick={() => openGroup(g.id)}
              >
                <div className="orbit-group-top">
                  <span className={`orbit-group-icon group-${g.color}`}>
                    <Icon name={g.icon} />
                  </span>
                  <span className="orbit-group-index">CIRCLE / 0{i + 1}</span>
                  <Icon name="diagonal" size={16} />
                </div>
                <h3>{g.name}</h3>
                <div className="orbit-group-detail">
                  <Avatars names={g.members} />
                  <strong>
                    {b.net >= 0 ? "+" : "−"}
                    {money(Math.abs(b.net))}
                  </strong>
                </div>
              </button>
            );
          })}
          <div className="orbit-member-note">
            <Avatar name="Simon" small />
            <span>
              Your people.
              <br />
              Your shared space.
            </span>
            <span className="online-dot" />
          </div>
        </aside>
      </div>
    </>
  );
}

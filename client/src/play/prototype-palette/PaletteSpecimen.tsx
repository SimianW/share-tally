// PROTOTYPE ONLY (#94): palette specimen at #/prototype/palette. Mock content, no API.
import { Notification } from '../Notification';
import { Avatar, Button, Icon, Logo } from '../ui';
import { currentPalette, palettes } from './palette-choice';
import '../play.css';
import '../bills.css';
import './prototype-palette.css';

const roles = [
  ['--bg', 'Page'], ['--surface', 'Card'], ['--surface-sunken', 'Sunken'], ['--surface-selected', 'Selected'],
  ['--surface-highlight', 'Highlight card'], ['--action', 'Action'], ['--accent-ink', 'Accent ink'],
  ['--accent-decoration', 'Decoration'], ['--ink', 'Ink'], ['--ink-muted', 'Muted ink'], ['--line', 'Line'],
  ['--money-owed', 'Owed'], ['--money-owe', 'Owe'], ['--status-danger', 'Error'], ['--status-info', 'Info'],
];

const openBills = [
  { title: 'Costco run', meta: 'Sep 24 · paid by Bob · 2/4 confirmed', amount: '$184.62', badge: 'Enter your share', mine: true },
  { title: 'Snacks & paper towels', meta: 'Sep 22 · paid by Carol · 3/4 confirmed', amount: '$46.10', badge: 'Confirm your share', mine: true },
  { title: 'Bulk rice & oil', meta: 'Sep 20 · paid by you · 2/3 confirmed', amount: '$73.40', badge: 'Waiting for Dan', mine: false },
];

export default function PaletteSpecimen() {
  const palette = palettes.find(candidate => candidate.key === currentPalette())!;
  return <div className="play"><main className="specimen">
    <header className="specimen-header">
      <Logo />
      <div><span className="eyebrow">PALETTE SPECIMEN</span><strong>{palette.name}</strong><small>{palette.fonts}</small></div>
    </header>

    <section className="specimen-hero">
      <div>
        <span className="eyebrow">COSTCO CREW · 4 MEMBERS</span>
        <h1>Hey Alice, <mark>3 things need you</mark></h1>
        <p>Split shared purchases with friends and settle up without the awkward maths. <a href="#/prototype/palette">See how it works</a>.</p>
      </div>
      <div className="specimen-actions">
        <Button variant="secondary"><Icon name="basket" /> Members &amp; invites</Button>
        <Button><Icon name="plus" /> New bill</Button>
      </div>
    </section>

    <div className="specimen-grid">
      <section className="specimen-card specimen-dashboard" aria-label="Where you stand">
        <span className="eyebrow">WHERE YOU STAND</span>
        <p className="specimen-balance owed">You're owed <b>$42.10</b></p>
        <ul>
          <li><Avatar name="Bob" small /><span>You pay <b>Bob</b></span><b className="money owe">$18.40</b><Button variant="secondary">I sent this</Button></li>
          <li><Avatar name="Carol" small /><span><b>Carol</b> pays you</span><b className="money owed">$60.50</b><span className="specimen-muted">Suggested</span></li>
          <li><Avatar name="Dan" small /><span><b>Dan</b> says he sent $20.00</span><b className="money pending">Pending</b><Button>Review</Button></li>
        </ul>
        <p className="specimen-muted"><Icon name="clock" size={14} /> 2 open bills aren't counted yet.</p>
      </section>

      <section className="specimen-card" aria-label="Open bills">
        <h2>Open bills <span className="count">3</span></h2>
        <ul className="specimen-bills">
          {openBills.map(bill => <li key={bill.title}>
            <span className="purchase-icon" aria-hidden="true"><Icon name="basket" /></span>
            <div><strong>{bill.title}</strong><small>{bill.meta}</small></div>
            <div className="specimen-bill-end"><b>{bill.amount}</b><span className={`specimen-badge ${bill.mine ? 'mine' : 'waiting'}`}>{bill.badge}</span></div>
          </li>)}
        </ul>
        <p className="specimen-muted">History · 12 completed, 1 canceled</p>
      </section>

      <section className="specimen-card specimen-highlight" aria-label="Bill status card">
        <span className="eyebrow">✓ COMPLETE</span>
        <p>Left to match</p>
        <strong>$0.03</strong>
        <small>4/4 confirmed · Difference assigned to the initiator</small>
      </section>

      <section className="specimen-card specimen-notices" aria-label="Notifications">
        <Notification tone="success" title="Bill updated">Your share was saved.</Notification>
        <Notification tone="info" title="Waiting for everyone to confirm.">Balances update when the bill completes.</Notification>
        <Notification tone="warning" title="Review the latest bill">Bob changed the total after you confirmed.</Notification>
        <Notification tone="error">Failed to fetch. Retry sends the same request.</Notification>
      </section>

      <section className="specimen-card" aria-label="Money states and avatars">
        <h2>Money &amp; people</h2>
        <div className="specimen-chips">
          <span className="money-chip owed">You're owed $42.10</span>
          <span className="money-chip owe">You owe $18.40</span>
          <span className="money-chip pending">Pending $20.00</span>
          <span className="money-chip settled">Settled ✓</span>
        </div>
        <div className="specimen-avatars">
          {['Simon', 'Emma', 'Alex', 'Jamie', 'Riley'].map(name => <Avatar key={name} name={name} />)}
          <span className="specimen-group-icon" aria-hidden="true">🛒</span>
          <span className="specimen-todo">1 to do</span>
        </div>
        <label className="specimen-field">Amount sent · CAD<input defaultValue="18.40" /></label>
        <div className="specimen-actions">
          <Button>Record transfer</Button>
          <Button variant="secondary">Close</Button>
          <Button disabled>Saving…</Button>
          <button type="button" className="specimen-danger">Cancel this bill</button>
        </div>
      </section>

      <section className="specimen-card" aria-label="Type and swatches">
        <h2>Type &amp; roles</h2>
        <p className="specimen-type-lg">Weekend groceries</p>
        <p>Body copy explains what happens next, in plain words. <span className="specimen-muted">Muted metadata · Sep 26</span></p>
        <div className="specimen-swatches">
          {roles.map(([token, label]) => <span key={token}><i style={{ background: `var(${token})` }} />{label}</span>)}
        </div>
      </section>
    </div>
  </main></div>;
}

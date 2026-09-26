import { useEffect, type ReactNode } from 'react';
import { Check, ChevronRight, Link2, Plus, UsersRound } from 'lucide-react';
import { AttentionList } from './AttentionList';
import { onMemberReturn, useAttention, type Attention } from './attention';
import { money } from './bill-api';
import { useGroupApi, type ListedGroup } from './group-api';
import { GroupIconView } from './GroupIconView';
import { Notification } from './Notification';
import { Avatar, Button, SectionHeading } from './ui';
import './home.css';

// Home: what needs the member, then every group they belong to.
export function Home({ name, groups, loading, error, revision, retry, notice, onCreate }: {
  name: string;
  groups: ListedGroup[] | undefined;
  loading: boolean;
  error: string;
  revision: number;
  retry: () => void;
  notice: ReactNode;
  onCreate: () => void;
}) {
  const api = useGroupApi();
  const attention = useAttention(String(revision));
  // Balances live in the group list, so it reloads with the actions.
  useEffect(() => {
    const load = () => void api.list().catch(() => {});
    load();
    return onMemberReturn(load);
  }, [api]);

  return <>
    <HomeHeading name={name} attention={attention} onCreate={onCreate} />
    {notice}
    <AttentionList attention={attention} />
    {error && <Notification>
      <p>{error}</p>
      <Button onClick={retry} disabled={loading}>Try again</Button>
    </Notification>}
    {groups?.length === 0 ? <NoGroups onCreate={onCreate} /> : (groups || loading) && <section className="home-groups" aria-labelledby="home-groups-heading">
      <SectionHeading id="home-groups-heading" title="Your groups" count={groups?.length} action="Refresh" onAction={retry} />
      {groups ? <ul className="home-group-list">
        {groups.map(group => <li key={group.id}><GroupRow group={group} count={attention.error ? null : attention.actions?.filter(action => action.groupId === group.id).length ?? group.pendingActionCount} /></li>)}
        <li>
          <button type="button" className="home-group-row home-new-group" onClick={onCreate}>
            <Plus size={18} strokeWidth={2.4} aria-hidden="true" />New group
          </button>
        </li>
      </ul> : <GroupRowsLoading />}
    </section>}
  </>;
}

function HomeHeading({ name, attention, onCreate }: { name: string; attention: Attention; onCreate: () => void }) {
  const count = attention.actions?.length;
  // Announce the overall count once, not every group row. While unknown, the
  // live region is empty and busy rather than repeating the loading skeleton.
  const announcement = count === undefined ? '' : count === 0 ? "You're all caught up"
    : `${count} ${count === 1 ? 'thing needs' : 'things need'} you`;
  // Until the actions arrive the state is unknown: never claim the member is caught up.
  // After a failed read, the greeting stands alone and the list explains the error.
  const state = count === undefined
    ? !attention.error && <span className="home-state-loading" role="status">
      <span className="sr-only">checking what needs you</span>
    </span>
    : count > 0
      ? <span className="home-state"><mark>{count} {count === 1 ? 'thing needs' : 'things need'}</mark> you</span>
      : <span className="home-state home-state-clear">you're all caught up
        <span className="home-state-check"><Check size={18} strokeWidth={3} aria-hidden="true" /></span>
      </span>;
  return <header className="page-header home-heading">
    <div>
      <div className="eyebrow">YOUR SHARED PURCHASES</div>
      <h1>Hey {name}{state && ','} {state}</h1>
      <span className="sr-only home-actions-announcement" aria-live="polite" aria-atomic="true" aria-busy={count === undefined}>{announcement}</span>
    </div>
    <Button onClick={onCreate}>
      <Plus size={20} strokeWidth={2} aria-hidden="true" />
      New group
    </Button>
  </header>;
}

function GroupRow({ group, count }: { group: ListedGroup; count: number | null }) {
  return <a className="home-group-row" href={`#/group-bills/${group.id}`}>
    <span className="home-group-icon"><GroupIconView icon={group.icon} size={24} /></span>
    <span className="home-group-main">
      <strong className="home-group-name">{group.name}</strong>
      <span className="home-group-members">
        <span className="home-group-faces" aria-hidden="true">
          {group.memberPreview.map(member => <Avatar key={member.id} name={member.displayName} small
            imageUrl={member.imageUrl} fallbackImageUrl={member.fallbackImageUrl} />)}
        </span>
        {group.memberCount} {group.memberCount === 1 ? 'member' : 'members'}
      </span>
    </span>
    <span className="home-group-status">
      <GroupBalance cents={group.netCents} />
      {count !== null && <span className={`home-group-pending${count === 0 ? " none" : ""}`}>
        {count === 0 ? "Nothing to do" : `${count} to do`}
      </span>}
    </span>
    <ChevronRight className="home-group-chevron" size={20} aria-hidden="true" />
  </a>;
}

// The member's own balance in the group, as the group list reports it.
function GroupBalance({ cents }: { cents: number | null }) {
  if (cents === null) return null;
  const [tone, label] = cents > 0 ? ['owed', "You're owed"] : cents < 0 ? ['owe', 'You owe'] : ['settled', 'All square'];
  return <span className={`home-balance ${tone}`}>
    <small>{label}</small>{' '}
    <b>{cents === 0 ? 'Settled' : money(Math.abs(cents))}</b>
  </span>;
}

function GroupRowsLoading() {
  return <div className="home-group-list home-group-skeleton" role="status" aria-label="Loading groups">
    {[0, 1, 2].map(row => <div key={row} className="home-group-row">
      <span className="home-group-icon" /><span className="home-skeleton-lines"><span /><span /></span><span className="home-skeleton-amount" />
    </div>)}
  </div>;
}

function NoGroups({ onCreate }: { onCreate: () => void }) {
  return <section className="home-empty" aria-labelledby="home-empty-heading">
    <span className="home-empty-icon"><UsersRound size={30} strokeWidth={1.8} aria-hidden="true" /></span>
    <h2 id="home-empty-heading">Your people, together.</h2>
    <p>Start with a group for your next shared purchase.</p>
    <Button onClick={onCreate}>
      <Plus size={20} strokeWidth={2} aria-hidden="true" />
      Create your first group
    </Button>
    <p className="home-empty-hint">
      <Link2 size={16} strokeWidth={2.2} aria-hidden="true" />
      <span>Joining friends? Ask them to send you their group's invitation link.</span>
    </p>
  </section>;
}

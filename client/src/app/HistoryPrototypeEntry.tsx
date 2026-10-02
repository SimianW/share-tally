// Throwaway standalone dev entry: real group page, sample data, no auth or API.
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MotionConfig } from 'motion/react';
import { GroupPage } from './GroupPage';
import { TopBar } from './TopBar';
import { Logo } from '../shared/ui/Logo';
import { historyPrototypeApi, historyPrototypeData } from './history-prototype-data';
import '../index.css';
import './styles.css';

document.documentElement.dataset.palette = 'classic';
document.documentElement.dataset.scheme = 'light';
if (!new URLSearchParams(window.location.search).has('variant')) {
  const url = new URL(window.location.href);
  url.searchParams.set('variant', 'A');
  url.hash = '/group-bills/history-prototype';
  window.history.replaceState(null, '', url);
}

export function HistoryPrototypePage() {
  const [scenario, setScenario] = useState('mixed');
  const data = historyPrototypeData(scenario);
  return <div className="play history-prototype-shell" onClickCapture={event => {
    const target = event.target as HTMLElement;
    // Keep the surrounding page visible for context; only history controls are active.
    if (!target.closest('.history-prototype, .history-prototype-banner') && target.closest('button, a')) {
      event.preventDefault();
      event.stopPropagation();
    }
    if (target.closest('.history-prototype a')) event.preventDefault();
  }}>
    <TopBar account={{ name: 'Simon', openProfile: () => {}, signOut: () => {} }} openAccount={() => {}} />
    <main className="main-content">
      <div className="history-prototype-banner">
        <span>History prototype · Sample data</span>
        <label>Try a case <select value={scenario} onChange={event => setScenario(event.target.value)}>
          <option value="mixed">Your screenshot</option>
          <option value="only-canceled">Only canceled bills</option>
          <option value="no-canceled">No canceled bills</option>
          <option value="long">Long history</option>
          <option value="empty">No history</option>
        </select></label>
      </div>
      <GroupPage key={scenario} data={data} title={<h2>Our place</h2>} drafts={null}
        api={historyPrototypeApi} refresh={() => {}} openMembers={() => {}} />
      <footer className="page-footer"><Logo compact /><span>Made for the people you share life with.</span><span>CAD</span></footer>
    </main>
  </div>;
}

const root = createRoot(document.getElementById('root')!);
root.render(<StrictMode><MotionConfig reducedMotion="user"><HistoryPrototypePage /></MotionConfig></StrictMode>);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());

// PROTOTYPE (throwaway): renders the real GroupPage with a fake group, without
// Clerk or the API, so the balance breakdown variants can be judged in place.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { applySavedPalette, applySavedScheme } from '../appearance';
import type { BillApi } from '../bill-api';
import { GroupPage } from '../GroupPage';
import { mockGroup } from './mock-group';
import '../../index.css';
import '../play.css';
import '../group-workspace.css';

applySavedPalette();
applySavedScheme();

const api = new Proxy({}, { get: () => async () => { throw new Error('Prototype: no API'); } }) as BillApi;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <div className="play">
      <main className="main-content">
        <div className="workspace-content">
          <GroupPage data={mockGroup} api={api} refresh={() => {}} openMembers={() => {}} drafts={null}
            title={<h2>🛒 Costco Crew</h2>} />
        </div>
      </main>
    </div>
  </StrictMode>,
);

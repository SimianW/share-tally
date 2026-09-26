import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ClerkProvider } from '@clerk/react';
import './index.css';
import App from './App.tsx';

// PROTOTYPE ONLY (issue #82): dev-only mock Home at #/prototype/home, no auth or API.
if (import.meta.env.DEV && window.location.hash.startsWith('#/prototype/home')) {
  const { default: HomePrototype } = await import('./play/prototype-home/HomePrototype');
  createRoot(document.getElementById('root')!).render(<StrictMode><HomePrototype /></StrictMode>);
} else {
  renderApp();
}

function renderApp() {
const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

if (!publishableKey) {
  throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY，check your .env.local file.');
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ClerkProvider publishableKey={publishableKey}>
      <App />
    </ClerkProvider>
  </StrictMode>,
);
}

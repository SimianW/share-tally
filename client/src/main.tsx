import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ClerkProvider } from '@clerk/react';
import './index.css';
import App from './App.tsx';

if (import.meta.env.DEV && window.location.hash.startsWith('#/prototype/drafts')) {
  void import('./play/DraftListPrototype').then(({ default: Prototype }) => {
    createRoot(document.getElementById('root')!).render(<StrictMode><Prototype /></StrictMode>);
  });
} else {
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

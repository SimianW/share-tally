import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ClerkProvider } from '@clerk/react';
import './index.css';
import App from './App.tsx';
// PROTOTYPE ONLY (#94): palette switching and the specimen route. Never merged.
import { applyPalette, currentPalette } from './play/prototype-palette/palette-choice';
import { PaletteSwitcher } from './play/prototype-palette/PaletteSwitcher';
import PaletteSpecimen from './play/prototype-palette/PaletteSpecimen';
import { applyButtons, currentButtons } from './play/prototype-buttons/button-choice';
import './play/prototype-buttons/prototype-buttons.css';

applyPalette(currentPalette());
applyButtons(currentButtons());
if (localStorage.getItem('prototype-hide-switcher') === '1') document.documentElement.dataset.hideSwitcher = '';
const switcherRoot = document.createElement('div');
document.body.append(switcherRoot);
createRoot(switcherRoot).render(<PaletteSwitcher />);

const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

// The specimen needs no sign-in, so it renders even without a Clerk key.
if (window.location.hash.startsWith('#/prototype/palette')) {
  createRoot(document.getElementById('root')!).render(<StrictMode><PaletteSpecimen /></StrictMode>);
} else if (!publishableKey) {
  throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY，check your .env.local file.');
} else createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ClerkProvider publishableKey={publishableKey}>
      <App />
    </ClerkProvider>
  </StrictMode>,
);

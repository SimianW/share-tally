import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ClerkProvider } from '@clerk/react';
import './index.css';
import App from './App.tsx';
import ReceiptDemo from './play/receipt-demo/ReceiptDemo.tsx';

const receiptDemo = import.meta.env.DEV && window.location.hash.startsWith('#/prototype/receipts/');

const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

if (!publishableKey && !receiptDemo) {
  throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY，check your .env.local file.');
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {receiptDemo ? <ReceiptDemo /> : <ClerkProvider publishableKey={publishableKey}>
      <App />
    </ClerkProvider>}
  </StrictMode>,
);

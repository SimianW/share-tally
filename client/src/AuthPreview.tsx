import { ClerkProvider } from "@clerk/react";
import App from "./App";
export default function AuthPreview() {
  const key = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
  if (!key)
    return (
      <main className="auth-preview">
        <h1>ShareTally sign-in</h1>
        <p>
          Set VITE_CLERK_PUBLISHABLE_KEY in client/.env.local to use the
          original sign-in screen.
        </p>
        <a href="/">Back to the UI demo</a>
      </main>
    );
  return (
    <ClerkProvider publishableKey={key}>
      <div className="auth-preview">
        <App />
      </div>
    </ClerkProvider>
  );
}

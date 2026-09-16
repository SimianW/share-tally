import {
  Show,
  SignInButton,
  SignUpButton,
  UserButton,
  useUser,
} from "@clerk/react";

import { useRoute } from './play/route';
import { SessionQueries } from './play/SessionQueries';
import PlayApp from "./play/PlayApp";
import { Logo } from "./play/ui";

function SignedInApp() {
  const { user } = useUser();
  if (!user) return <p role="status">Loading your account…</p>;
  return (
    <SessionQueries key={user.id}><PlayApp
      displayName={user.firstName || user.fullName || "friend"}
      accountControl={<UserButton />}
    /></SessionQueries>
  );
}

function App() {
  const route = useRoute();
  // Keep the invitation fragment through the external Google sign-in redirect.
  const returnUrl = `${window.location.origin}/${route}`;
  return (
    <>
      <Show when="signed-out">
        <main className="play sign-in-page">
          <Logo />
          <h1>Shared purchases start here.</h1>
          <p>{route.startsWith('#/join/') ? 'Sign in to accept your group invitation.' : 'Sign in to manage shared expenses.'}</p>

          <SignInButton mode="modal" forceRedirectUrl={returnUrl} signUpForceRedirectUrl={returnUrl}>
            <button className="button primary" type="button">
              Sign in
            </button>
          </SignInButton>

          <SignUpButton mode="modal" forceRedirectUrl={returnUrl} signInForceRedirectUrl={returnUrl}>
            <button className="button secondary" type="button">
              Sign up
            </button>
          </SignUpButton>
        </main>
      </Show>

      <Show when="signed-in">
        <SignedInApp />
      </Show>
    </>
  );
}

export default App;

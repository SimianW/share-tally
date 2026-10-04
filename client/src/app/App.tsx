import { Show, SignInButton, SignUpButton, useClerk, useUser, } from "@clerk/react";
import { useRoute } from '../shared/browser/route';
import { SessionQueries } from '../shared/api/SessionQueries';
import AppShell from "./AppShell";
import { Logo } from "../shared/ui/Logo";
import { useProfileSync } from "../features/account/profile-sync";
import { resolveDisplayName } from "@share-tally/domain/display-name";

function SignedInApp() {
  const { user } = useUser();
  if (!user) return <p role="status">Loading your account…</p>;
  return <SignedInAccount user={user} />;
}

function SignedInAccount({ user }: { user: NonNullable<ReturnType<typeof useUser>['user']> }) {
  const clerk = useClerk();
  const reload = () => void user.reload().catch(() => {});
  // The same rule the server applies to every member's name.
  const displayName = resolveDisplayName(user);
  return (
    <SessionQueries key={user.id}><ProfileSynchronization user={user} reload={reload} /><AppShell
      displayName={displayName}
      account={{
        name: displayName,
        email: user.primaryEmailAddress?.emailAddress,
        imageUrl: user.imageUrl,
        openProfile: () => clerk.openUserProfile(),
        reload,
        signOut: () => void clerk.signOut(),
      }}
    /></SessionQueries>
  );
}

function ProfileSynchronization({ user, reload }: { user: NonNullable<ReturnType<typeof useUser>['user']>; reload: () => void }) {
  useProfileSync(user, reload);
  return null;
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

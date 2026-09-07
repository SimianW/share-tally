import {
  Show,
  SignInButton,
  SignUpButton,
  UserButton,
} from '@clerk/react'

function App() {
  return (
    <main>
      <h1>ShareTally</h1>

      <Show when="signed-out">
        <p>Sign in to manage shared expenses.</p>

        <SignInButton mode="modal">
          <button type="button">Sign in</button>
        </SignInButton>

        <SignUpButton mode="modal">
          <button type="button">Sign up</button>
        </SignUpButton>
      </Show>

      <Show when="signed-in">
        <p>You are signed in to ShareTally.</p>
        <UserButton />
      </Show>
    </main>
  )
}

export default App

import { createTransport } from '../../shared/api/transport';
import { useState } from "react";
import { useSyncSession } from '../../shared/api/SyncSession';

export default function AccountCheck() {
  const session = useSyncSession();
  const { getToken } = session;
  const [result, setResult] = useState('');
  const [isChecking, setIsChecking] = useState(false);

  async function checkAccount() {
    setIsChecking(true);
    setResult('');

    try {
      const transport = createTransport(getToken, {
        unauthenticated: () => new Error('No active session. Please sign in again.'),
        failed: ({ status }) => new Error(`Account request failed. ${status}`),
      }, session);
      const data = await transport.json<unknown>('/me', 'GET', undefined, undefined, false);
      setResult(JSON.stringify(data, null, 2));
    } catch (error) {
      setResult(
        error instanceof Error ? error.message : 'Unknown error',
      );
    } finally {
      setIsChecking(false);
    }
  }

  return (
    <section>
      <button
        type="button"
        className="button primary"
        onClick={checkAccount}
        disabled={isChecking}
      >
        {isChecking ? 'Checking...' : 'Check Account identity'}
      </button>

      {result && (
        <pre>
          {result}
        </pre>
      )}
    </section>
  );
}
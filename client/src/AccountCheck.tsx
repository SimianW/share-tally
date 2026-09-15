import { useState } from "react";
import { useAuth } from "@clerk/react";

export default function AccountCheck() {
  const { getToken } = useAuth();
  const [result, setResult] = useState('');
  const [isChecking, setIsChecking] = useState(false);

  async function checkAccount() {
    setIsChecking(true);
    setResult('');

    try {
      const token = await getToken();

      if (!token) {
        throw new Error('No active session. Please sign in again.');
      }

      const response = await fetch('/api/me', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Account request failed. ${response.status}`);
      }

      const data: unknown = await response.json();
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
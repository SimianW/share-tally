import { useOperation } from '../../shared/api/use-operation';
import { useRef, useState } from "react";
import { BillApiError } from "../../shared/api/bill-error";
import { type Bill } from "@share-tally/domain/contracts/bills";
import { errorMessage } from "../../shared/api/error-message";

// Keep an uncertain request unchanged. Version checks make retries safe even if
// the first response was lost; a 409 requires reviewing the latest bill.
export function useBillMutation(saved: (bill: Bill) => void) {
  const { pending, busy, error, setError, execute } = useOperation();
  const attempt = useRef<(() => Promise<{ bill: Bill }>) | null>(null);
  const [conflict, setConflict] = useState(false);
  const [retry, setRetry] = useState(false);
  async function run(action: () => Promise<{ bill: Bill }>) {
    if (pending.current || conflict) return;

    await execute(async () => {
      attempt.current ??= action;
      const result = await attempt.current();
      attempt.current = null;
      setRetry(false);
      saved(result.bill);
    }, (error) => {
      const definite = error instanceof BillApiError && error.status < 500;
      if (definite) attempt.current = null;
      setRetry(!definite);
      setConflict(
        error instanceof BillApiError && [403, 404, 409].includes(error.status),
      );
      setError(errorMessage(error));
    });
  }
  return {
    run,
    busy,
    error,
    conflict,
    retry,
    locked: busy || retry || conflict,
    reset() { attempt.current = null; setError(""); setRetry(false); setConflict(false); },
  };
}
export function useBillDraftReview(bill: Bill, signature: string, mutation: ReturnType<typeof useBillMutation>) {
  const [reviewed, setReviewed] = useState(signature);
  const terminal = !!(bill.completedAt || bill.canceledAt);
  return {
    blocked: terminal || reviewed !== signature,
    notice: terminal ? `This bill is ${bill.canceledAt ? 'canceled' : 'complete'}. Your draft is retained; submission is disabled.`
      : reviewed !== signature ? 'This bill changed. Your draft is retained. Review the latest bill before submitting.' : '',
    review() { setReviewed(signature); mutation.reset(); },
    terminal,
  };
}

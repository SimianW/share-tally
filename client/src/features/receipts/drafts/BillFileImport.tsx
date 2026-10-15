import { readBillFile, type BillFileDraft, type BillFileReason } from '@share-tally/domain/bill-file';
import type { ReceiptData } from '@share-tally/domain/contracts/receipts';
import { CircleAlert, FileJson, PencilLine } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import Dialog from '../../../shared/ui/Dialog';
import { Button } from '../../../shared/ui/Button';

const messages: Record<BillFileReason, string> = {
  invalid: "This file isn't a sharetally bill",
  'newer-version': 'This file was made by a newer version of sharetally',
  'too-many-items': 'This bill has more than 200 items',
  numbers: "The numbers in this file don't add up",
};

/** A separate picker keeps bill files out of the receipt photo/cropping path. */
export function BillFileImport({ draft, apply, typeItems }: {
  draft: ReceiptData;
  apply: (data: BillFileDraft) => Promise<boolean>;
  typeItems: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const pick = useRef(0);
  const latestDraft = useRef(draft);
  useEffect(() => { latestDraft.current = draft; }, [draft]);
  useEffect(() => () => { pick.current++; }, []);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState('');
  const [pending, setPending] = useState<{ filename: string; data: BillFileDraft } | null>(null);

  async function choose(file: File) {
    const selection = ++pick.current;
    setError('');
    setPending(null);
    if (file.size > 1024 * 1024) { setError('This file is too large (max 1 MB)'); return; }
    if (!file.name.toLowerCase().endsWith('.json')) {
      setError(messages.invalid);
      return;
    }
    setReading(true);
    try {
      const text = await file.text();
      if (selection !== pick.current) return;
      const result = readBillFile(text);
      if (!result.ok) { setError(messages[result.reason]); return; }
      const current = latestDraft.current;
      if (current.title || current.items.length || current.totalCents !== null)
        setPending({ filename: file.name, data: result.draft });
      else void apply(result.draft);
    } catch {
      if (selection === pick.current) setError(messages.invalid);
    } finally {
      if (selection === pick.current) setReading(false);
    }
  }

  return <>
    <div className="receipt-entry-alternative">
      No receipt to hand?
      <Button variant="text" disabled={reading} onClick={typeItems}><PencilLine size={17} aria-hidden="true" /> Type the items in</Button>
      <Button variant="text" disabled={reading} onClick={() => { setError(''); input.current?.click(); }}><FileJson size={17} aria-hidden="true" /> Import a bill</Button>
      <input ref={input} type="file" hidden accept=".json,application/json" aria-label="Import a bill file" onChange={event => {
        const file = event.currentTarget.files?.[0];
        event.currentTarget.value = '';
        if (file) void choose(file);
      }} />
    </div>
    {error && <div className="bill-file-error" role="alert">
      <CircleAlert size={19} aria-hidden="true" /><div><strong>{error}</strong><p>Nothing has been filled in.</p></div>
    </div>}
    {pending && <Dialog title="Replace what's in this draft with the imported bill?" kicker="Import a bill" close={() => setPending(null)}>
      <p>Your current items and details will be replaced by <strong>{pending.filename}</strong>.</p>
      <div className="dialog-actions">
        <Button variant="secondary" onClick={() => setPending(null)}>Keep draft</Button>
        <Button onClick={() => { const data = pending.data; setPending(null); void apply(data); }}>Replace draft</Button>
      </div>
    </Dialog>}
  </>;
}

import { useEffect, useState } from 'react';
import './receipt-demo.css';

import { evaluateChecks, matchesAll, type Engine, type Fixture, type Result } from './evaluation';
type Config = { configured: boolean; model: string; fixtures: Fixture[]; results: Result[] };
const money = (n: number | null | undefined) => n == null ? 'Unknown' : n.toFixed(2);

export default function ReceiptDemo() {
  const [config, setConfig] = useState<Config | null>(null);
  const [engine, setEngine] = useState<Engine>(window.location.hash.endsWith('receipt-scanner') ? 'receipt-scanner' : 'ai-sdk');
  const [selected, setSelected] = useState('001');
  const [results, setResults] = useState<Result[]>([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [upload, setUpload] = useState<{ base64: string; mediaType: string; name: string; url: string } | null>(null);
  async function refresh() {
    try { const r = await fetch('/receipt-demo-api/config'); if (!r.ok) throw new Error('Start the demo with pnpm demo:receipts in server/.'); const c: Config = await r.json(); setConfig(c); setResults(c.results); } catch (e) { setError(e instanceof Error ? e.message : 'Could not load demo'); }
  }
  useEffect(() => {
    let active = true;
    fetch('/receipt-demo-api/config').then(async r => {
      if (!r.ok) throw new Error('Start the demo with pnpm demo:receipts in server/.');
      const c: Config = await r.json();
      if (active) { setConfig(c); setResults(c.results); }
    }).catch(e => { if (active) setError(e instanceof Error ? e.message : 'Could not load demo'); });
    const handler = () => setEngine(window.location.hash.endsWith('receipt-scanner') ? 'receipt-scanner' : 'ai-sdk');
    window.addEventListener('hashchange', handler);
    return () => { active = false; window.removeEventListener('hashchange', handler); };
  }, []);
  const fixture = config?.fixtures.find(f => f.id === selected);
  const result = results.find(r => r.engine === engine && r.receiptId === selected);
  async function run(target: Engine, id: string) {
    setBusy(`${target}:${id}`); setError('');
    try {
      const response = await fetch('/receipt-demo-api/extract', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ engine: target, receiptId: id, upload: id === 'upload' ? upload : undefined }) });
      const body = await response.json();
      if (body.status === 'error' || response.ok) setResults(old => [...old.filter(r => !(r.engine === target && r.receiptId === id)), body]);
      if (!response.ok) throw new Error(body.error || 'Extraction failed');
      return true;
    } catch (e) { setError(e instanceof Error ? e.message : 'Extraction failed'); return false; }
    finally { setBusy(''); }
  }
  async function runAll() {
    for (const target of ['ai-sdk', 'receipt-scanner'] as const) for (const f of config?.fixtures ?? []) await run(target, f.id);
  }
  const data = result?.data;
  const name = engine === 'ai-sdk' ? 'AI SDK + vision' : 'receipt-ai-scanner';
  return <main className="receipt-lab">
    <header className="lab-header"><a className="lab-brand" href="#/prototype/receipts/ai-sdk"><span>↗</span> ShareTally <small>LAB</small></a><span className="lab-tag">Receipt extraction / working demo</span><a href="https://github.com/zzzDavid/ICDAR-2019-SROIE" target="_blank" rel="noreferrer">Dataset source ↗</a></header>
    <section className="lab-intro"><p className="lab-eyebrow">FROM PAPER TO LINE ITEMS</p><h1>One receipt.<br/><em>Two ways to read it.</em></h1><p>Compare two open-source libraries on real receipts. Same images, same vision model. Inspect every item and the actual API response.</p></section>
    <nav className="lab-tabs" aria-label="Extraction library"><a aria-current={engine === 'ai-sdk' ? 'page' : undefined} href="#/prototype/receipts/ai-sdk"><b>01</b> AI SDK + vision <span>Custom schema</span></a><a aria-current={engine === 'receipt-scanner' ? 'page' : undefined} href="#/prototype/receipts/receipt-scanner"><b>02</b> receipt-ai-scanner <span>Receipt library</span></a></nav>
    <div className="lab-status"><span className={config?.configured ? 'dot ready' : 'dot'} />{config?.configured ? 'Provider key configured' : 'Waiting for a provider key'}<span>{config?.model ?? 'Loading model…'} · BYOK · Google Gemini</span><button onClick={() => void refresh()} disabled={!!busy}>Refresh key status</button></div>
    {!config?.configured && <div className="lab-notice">Add <code>GOOGLE_GENERATIVE_AI_API_KEY</code> to <code>server/.env</code>, then refresh key status. Receipts and expected values are real; no model results are fabricated.</div>}
    <section className="lab-workspace">
      <aside className="lab-samples"><p className="lab-eyebrow">TEST COLLECTION / {config?.fixtures.length ?? 0}</p>{config?.fixtures.map(f => <button className={selected === f.id ? 'sample selected' : 'sample'} key={f.id} disabled={!!busy} onClick={() => { setSelected(f.id); setError(''); }}><img src={`/demo-receipts/${f.id}.jpg`} alt=""/><span><small>{f.tag}</small><strong>{f.name}</strong><span>{f.expected.itemCount} items · {f.expected.currency} {money(f.expected.total)}</span></span></button>)}
        <label className="lab-upload">＋ Try your own receipt<input disabled={!!busy} type="file" accept="image/jpeg,image/png,image/webp" onChange={async e => { const file = e.target.files?.[0]; if (!file) return; if (file.size > 8 * 1024 * 1024) { setError('Use an image smaller than 8 MB.'); return; } const reader = new FileReader(); reader.onload = () => { const url = String(reader.result); setUpload({ base64: url.split(',')[1], mediaType: file.type, name: file.name, url }); setSelected('upload'); setResults(old => old.filter(r => r.receiptId !== 'upload')); }; reader.readAsDataURL(file); }}/></label>
        <p className="lab-footnote">Real SROIE scans, including faded, skewed and long receipts. Expected amounts were transcribed from annotations and checked against the scans before extraction. MYR and MAD samples; no synthetic damage. This is a small selected sample, not a general accuracy benchmark.</p>
      </aside>
      <section className="lab-paper"><div className="panel-heading"><div><small>ORIGINAL RECEIPT</small><h2>{fixture?.name ?? upload?.name ?? 'Receipt'}</h2></div>{fixture && <a href={fixture.source} target="_blank" rel="noreferrer">Source ↗</a>}</div><a href={fixture ? `/demo-receipts/${selected}.jpg` : upload?.url} target="_blank" rel="noreferrer"><img className="receipt-image" src={fixture ? `/demo-receipts/${selected}.jpg` : upload?.url} alt={`Original receipt from ${fixture?.name ?? 'upload'}`}/></a><p>{fixture?.description ?? 'Your image is sent to Google only when you run extraction. Uploaded images and results are not saved to disk.'}</p></section>
      <section className="lab-output"><div className="panel-heading"><div><small>EXTRACTED WITH</small><h2>{name}</h2></div><span className="lab-pill">{result?.status === 'error' ? 'API ERROR' : result ? 'SAVED API RESULT' : 'NOT RUN'}</span></div>
        <button className="lab-run" disabled={!!busy || !config?.configured} onClick={() => void run(engine, selected)}>{busy === `${engine}:${selected}` ? 'Reading receipt…' : result ? 'Run extraction again ↗' : 'Extract this receipt ↗'}</button>
        {(error || result?.error) && <p role="alert" className="lab-error">{error || result?.error}</p>}
        {data ? <><div className="lab-metrics"><div><small>AMOUNT DUE</small><strong>{data.currency} {money(data.total)}</strong></div><div><small>ITEMS</small><strong>{data.items.length}</strong></div><div><small>TIME</small><strong>{(result.durationMs / 1000).toFixed(1)}s</strong></div></div><div className="table-scroll"><table><thead><tr><th>Item</th><th>Qty</th><th>Unit</th><th>Amount</th></tr></thead><tbody>{data.items.map((item, i) => <tr key={i}><td>{item.description}</td><td>{item.quantity ?? '—'}</td><td>{money(item.unitPrice)}</td><td>{money(item.totalPrice)}</td></tr>)}</tbody></table></div><p>Discount: {money(data.discountTotal)} · Rounding: {money(data.roundingAdjustment)}</p>{data.warnings?.map((warning, i) => <p className="lab-notice" key={i}>{warning}</p>)}<p className="lab-footnote">Actual run: {new Date(result.ranAt).toLocaleString()} · {result.model}</p><details><summary>Full result & token usage</summary><pre>{JSON.stringify({ data, usage: result.usage }, null, 2)}</pre></details><details><summary>Raw model response</summary><pre>{result.raw}</pre></details></> : <div className="lab-empty"><span>⌁</span><h3>The receipt is ready.<br/>Let’s see what the model reads.</h3><p>Extracted items, timing, checks and raw JSON will appear here after a real API call.</p></div>}
        {fixture && <div className="lab-expected"><small>EXPECTED / FROM SOURCE ANNOTATIONS</small><div><strong>{fixture.expected.currency} {money(fixture.expected.total)}</strong><span>{fixture.expected.itemCount} items · discount {money(fixture.expected.discount)} · rounding {money(fixture.expected.rounding)}</span></div><p>Gross line amounts: {fixture.expected.lineAmounts.map(money).join(' / ')}</p><details><summary>Expected items &amp; scoring notes</summary><ol>{fixture.expected.itemDescriptions?.map((item, i) => <li key={i}>{item} · {money(fixture.expected.lineAmounts[i])}</li>)}</ol><p>{fixture.groundTruthNote}</p></details><a href={fixture.annotation} target="_blank" rel="noreferrer">Read source transcript ↗</a></div>}
        {fixture && result && <div className="lab-checks"><h3>Correctness checks</h3>{evaluateChecks(fixture, result).map(c => <div key={c.label}><span>{c.label}</span><strong className={`check-${c.status}`}>{c.status === 'na' ? 'Not scored' : c.status === 'pass' ? 'Match' : c.status === 'error' ? 'API error' : 'Mismatch'}</strong><small>Expected: {c.expected} · Returned: {c.actual}</small></div>)}{fixture.reviewNotes?.[engine] && <p className="lab-notice">Review: {fixture.reviewNotes[engine]}</p>}</div>}
      </section>
    </section>
    <section className="lab-comparison"><div className="panel-heading"><div><p className="lab-eyebrow">SIDE BY SIDE</p><h2>Same test. Both libraries.</h2></div><button className="lab-run" disabled={!!busy || !config?.configured} onClick={() => void runAll()}>{busy ? 'Extraction in progress…' : `Run all ${(config?.fixtures.length ?? 0) * 2} extractions ↗`}</button></div><div className="lab-scorecards">{(['ai-sdk', 'receipt-scanner'] as const).map(e => {
      const runs = (config?.fixtures ?? []).map(f => ({ f, r: results.find(v => v.receiptId === f.id && v.engine === e) })).filter(v => v.r);
      const matches = runs.filter(({ f, r }) => matchesAll(f, r)).length;
      return <div key={e}><small>{e === 'ai-sdk' ? 'AI SDK + vision' : 'receipt-ai-scanner'}</small><strong>{runs.length ? `${matches} / ${runs.length}` : 'Not run'}</strong><span>receipts match all scored fields</span></div>;
    })}</div><p>Eight fields checked where ground truth is available. Unprinted quantities, unit prices, discounts and tax are not scored. RM/MYR and DH/MAD are treated as equivalent. Unknown currency is accepted where none is printed; a wrong token still fails. Rows and amounts use receipt order. Meal components without separate prices are not additional charged rows. Description wording and discount-to-item associations require manual review; this is not a complete semantic accuracy score. Rounding is shown separately because the receipt library has no rounding field.</p><div className="table-scroll"><table><thead><tr><th>Receipt</th><th>Library</th>{['Total', 'Priced rows', 'Line amounts', 'Quantities', 'Unit prices', 'Currency', 'Discount', 'Tax'].map(label => <th key={label}>{label}</th>)}<th>Time</th></tr></thead><tbody>{config?.fixtures.flatMap(f => (['ai-sdk', 'receipt-scanner'] as const).map(e => {
      const r = results.find(v => v.receiptId === f.id && v.engine === e);
      return <tr key={`${f.id}-${e}`}><td><button className="lab-result-link" onClick={() => { setSelected(f.id); window.location.hash = `/prototype/receipts/${e}`; document.querySelector('.lab-workspace')?.scrollIntoView({ behavior: 'smooth' }); }}>{f.name}</button></td><td>{e}</td>{evaluateChecks(f, r).map(c => <td key={c.label} title={`Expected: ${c.expected}; returned: ${c.actual}`}><span className={`check-${c.status}`}>{({ pass: 'Match', fail: 'Mismatch', pending: 'Not run', na: '—', error: 'API error' })[c.status]}</span></td>)}<td>{r ? `${(r.durationMs / 1000).toFixed(1)}s` : '—'}</td></tr>;
    }))}</tbody></table></div></section>
    <section className="lab-datasets"><p className="lab-eyebrow">BUILD YOUR OWN TEST SET</p><h2>Free receipt datasets</h2><div><article><h3><a href="https://huggingface.co/datasets/naver-clova-ix/cord-v2" target="_blank" rel="noreferrer">CORD v2 ↗</a></h3><strong>Best fit · CC BY 4.0</strong><p>1,000 Indonesian receipt images with grouped item names, quantities and price labels. Explicit dataset license; retain attribution.</p></article><article><h3><a href="https://github.com/zzzDavid/ICDAR-2019-SROIE" target="_blank" rel="noreferrer">SROIE ↗</a></h3><strong>These demo scans · data license unclear</strong><p>Public scans and OCR transcripts. Standard extraction labels cover merchant, address, date and total. We manually created item expectations here. The mirror's MIT code license does not establish image rights.</p></article><article><h3><a href="https://github.com/open-mmlab/mmocr/blob/v0.5.0/docs/en/datasets/kie.md" target="_blank" rel="noreferrer">WildReceipt ↗</a></h3><strong>1,740 receipt photos · terms need checking</strong><p>Product-name and price regions in photographed receipts. Useful for OCR research; a separate dataset license was not established in the checked sources.</p></article></div></section>
    <footer className="lab-footer">ShareTally receipt lab · Demo branch only · No bills or participant shares are changed.</footer>
  </main>;
}

// Opt-in; deliberately outside suites.mjs and every test/release gate.
// node ../scripts/build-domain.mjs && node scripts/record-demo.mjs [output-directory]
// Requires Docker, ffmpeg with x11grab/libx264 and Xvfb. Chromium comes from the
// browser harness image. Uses no production services.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { GenericContainer, Wait } from 'testcontainers';
import { serverRequire, startEnvironment } from '../test/browser/environment.mjs';
import { costcoFriends } from '../test/browser/groups/fixtures.mjs';
import { groupNet } from '../test/browser/ui.mjs';

const output = resolve(process.argv[2] ?? '/tmp/retro/demo');
const scenes = [
  ['title', 3, 'ShareTally: split shared purchases, settle up fairly'],
  ['group', 5, 'Your group, bills, and balance at a glance'],
  ['scan', 5, 'Start with a receipt photo'],
  ['review', 6, 'Review items, prices, and tax before sharing'],
  ['sharing', 3, 'Choose who shares this purchase'],
  ['whole', 4, 'Claim the whole items you took home'],
  ['fraction', 8, 'Split shared items with exact fractions'],
  ['live', 5, 'Bob’s claims appear live for Alice'],
  ['record', 5, 'Carol records money sent outside ShareTally'],
  ['confirm', 5, 'Alice confirms receipt; balances update'],
  ['dark', 4, 'Your shared purchases, in dark mode'],
  ['mobile', 4, 'Keep your group handy on mobile'],
  ['end', 3, 'sharetally.app'],
];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const sharp = serverRequire('sharp');
const work = await mkdtemp(join(tmpdir(), 'sharetally-demo-'));
let env, context, display, recorder, captureBrowser, captureContainer, browserContainerId;
const errors = [];
async function command(binary, args) {
  const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', data => { stdout += data; });
  child.stderr.on('data', data => { stderr += data; });
  const [code] = await once(child, 'exit');
  assert.equal(code, 0, `${binary}: ${stderr}`);
  return stdout;
}
async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const done = once(child, 'exit');
  const timeout = setTimeout(() => child.kill('SIGKILL'), 5000);
  child.kill('SIGINT');
  try { await done; } finally { clearTimeout(timeout); }
}
// Frame the real app with a separate caption rail. No UI screenshot substitutes.
// Desktop is 1440 CSS px, mobile exactly 390; Chromium renders both at capture size.
function stageHTML() {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  @font-face{font-family:Nunito;src:url(/fonts/nunito-800-normal.ttf)}
  @font-face{font-family:DM;src:url(/fonts/dm-sans-500-normal.ttf)}
  *{box-sizing:border-box;cursor:none!important}body{margin:0;background:#fafbf8;color:#273323;font-family:DM,sans-serif;overflow:hidden}
  #app{position:absolute;left:132px;top:30px;width:1440px;height:800px;border:0;border-radius:18px;transform:scale(1.15);transform-origin:top left;box-shadow:0 5px 35px #15220e10}
  #caption{position:absolute;bottom:30px;left:96px;right:96px;text-align:center;font:500 28px DM;color:#fff}#caption span{display:inline-block;background:#273323;padding:13px 26px;border-radius:14px}
  #card{position:absolute;inset:0;display:none;align-items:center;justify-content:center;text-align:center}
  .brand{font:800 96px Nunito;letter-spacing:-4px}.dot{color:#83b445}.mark{display:inline-flex;gap:8px;transform:rotate(-12deg);margin-right:24px;vertical-align:middle}.mark i{width:15px;background:#273323;border-radius:8px;height:64px}.mark i:first-child{height:45px;margin-top:15px}.mark i:last-child{height:53px;margin-top:4px}
  .tagline{font:800 56px/1.2 Nunito;margin:30px 0 25px;letter-spacing:-1px}.url{font:500 30px DM;color:#53772c}.pill{display:inline-block;background:#e9f3d8;border:1px solid #d7e4c2;padding:12px 22px;border-radius:30px;font:500 19px DM;margin-bottom:28px}
  #mobile-copy{display:none;position:absolute;left:240px;top:350px;width:520px}#mobile-copy h1{font:800 64px/1.1 Nunito;letter-spacing:-2px;margin:0 0 24px}#mobile-copy p{font:500 26px/1.5 DM;color:#65705f}
  #cursor{position:absolute;left:0;top:0;width:28px;height:36px;z-index:10000;pointer-events:none;transform:translate(180px,120px);filter:drop-shadow(0 2px 3px #15220e40)}#ripple{position:absolute;width:44px;height:44px;border:2px solid #83b445;background:#c4f17830;border-radius:50%;z-index:9999;pointer-events:none;opacity:0}
  </style></head><body><iframe name="app" id="app"></iframe>
  <div id="card"><div><div class="pill">SHARED PURCHASES · FAIR SHARES</div><div class="brand"><span class="mark"><i></i><i></i><i></i></span>sharetally<span class="dot">.</span></div><div class="tagline" id="tagline">Split shared purchases,<br>settle up fairly.</div><div class="url">sharetally.app</div></div></div>
  <div id="mobile-copy"><div class="pill">ON YOUR PHONE</div><h1>A fair split.<br>Wherever you are.</h1><p>Check your balance.<br>See what needs your attention.</p></div>
  <div id="caption"><span></span></div><svg id="cursor" viewBox="0 0 28 36"><path d="M3 2 L3 29 L10 23 L16 34 L21 31 L15 20 L25 19 Z" fill="#273323" stroke="#fff" stroke-width="2" stroke-linejoin="round"/></svg><div id="ripple"></div>
  <script>window.setScene=(caption,mode)=>{document.querySelector('#caption span').textContent=caption;document.querySelector('#card').style.display=mode==='card'?'flex':'none';document.querySelector('#mobile-copy').style.display=mode==='mobile'?'block':'none';document.querySelector('#cursor').style.display=mode==='card'?'none':'block';document.querySelector('#app').style.cssText=mode==='mobile'?'left:1060px;top:35px;width:390px;height:844px;transform:scale(1.06)':'';document.querySelector('#app').style.display=mode==='card'?'none':'block';};</script></body></html>`;
}
try {
  await mkdir(join(output, 'frames'), { recursive: true });
  env = await startEnvironment({ checkpoint: async (stage, details) => {
    if (stage === 'browser-container') browserContainerId = details.browserContainerId;
  } });
  const { group, ids, billsUrl } = await costcoFriends(env, { name: 'Weekend shopping' });
  const participants = [ids.Alice, ids.Bob, ids.Carol];
  for (const [token, title, total] of [['alice-token', 'Saturday groceries', 9000], ['bob-token', 'Dinner together', 6000], ['carol-token', 'Picnic supplies', 3000]]) {
    let { bill } = await env.api(`/groups/${group.id}/bills`, token, 'POST', {
      requestId: randomUUID(), title, purchaseDate: '2026-10-10', timeZone: 'America/Toronto', notes: '', totalCents: total, participantIds: participants,
    });
    for (const member of ['alice-token', 'bob-token', 'carol-token']) {
      ({ bill } = await env.api(`/bills/${bill.id}/share`, member, 'POST', { revision: bill.revision, expectedAmountCents: null, amountCents: total / 3 }));
    }
    assert.ok(bill.completedAt);
  }
  await env.api(`/groups/${group.id}/bills`, 'bob-token', 'POST', {
    requestId: randomUUID(), title: 'Sunday brunch', purchaseDate: '2026-10-10', timeZone: 'America/Toronto', notes: '', totalCents: 2400, participantIds: participants,
  });
  const rows = [['Apples', 600], ['Bread', 400], ['Milk', 800], ['Dish soap', 1000]];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="620"><rect width="480" height="620" fill="#fffdf7"/><g fill="#262626" font-family="monospace" font-size="22"><text x="100" y="65" font-size="30">SAMPLE SHOP</text><text x="85" y="105" font-size="17">FICTIONAL RECEIPT · CAD</text><text x="35" y="165">2026-10-10</text>${rows.map(([name, cents], index) => `<text x="35" y="${225 + index * 52}">${name}</text><text x="355" y="${225 + index * 52}">${(cents / 100).toFixed(2)}</text>`).join('')}<text x="35" y="465">Subtotal</text><text x="355" y="465">28.00</text><text x="35" y="505">Tax</text><text x="370" y="505">1.30</text><text x="35" y="565" font-weight="bold">TOTAL</text><text x="355" y="565" font-weight="bold">29.30</text></g></svg>`;
  const photo = await sharp(Buffer.from(svg)).png().toBuffer();
  // Xvfb chooses an unused display: existing desktops/worktrees stay untouched.
  display = spawn('Xvfb', ['-displayfd', '3', '-screen', '0', '1920x1080x24', '-nolisten', 'tcp'], { stdio: ['ignore', 'ignore', 'inherit', 'pipe'] });
  const displayNumber = await new Promise((resolve, reject) => {
    display.once('error', reject);
    display.stdio[3].once('data', data => resolve(data.toString().trim()));
    display.once('exit', code => reject(new Error(`Xvfb exited: ${code}`)));
  });
  // The same browser image/loopback relay as the harness, with headed Chromium
  // on our X display. Its network namespace ignores unrelated Docker bridges.
  const image = (await command('docker', ['inspect', '--format', '{{.Config.Image}}', browserContainerId])).trim();
  const wsPath = `/${randomUUID()}`;
  const launcher = `import {once} from 'node:events';
    import {createConnection,createServer} from 'node:net';
    import {chromium} from 'playwright';
    const port=Number(process.env.APP_PORT);
    const relay=createServer({noDelay:true},socket=>{
      const upstream=createConnection({host:'host.docker.internal',port,noDelay:true});
      socket.on('error',()=>upstream.destroy()); upstream.on('error',()=>socket.destroy());
      socket.on('close',()=>upstream.destroy()); upstream.on('close',()=>socket.destroy());
      socket.pipe(upstream).pipe(socket);
    }); relay.listen(port,'127.0.0.1'); await once(relay,'listening');
    const browser=await chromium.launchServer({headless:false,host:'0.0.0.0',port:3000,
      wsPath:process.env.BROWSER_WS_PATH,args:['--kiosk','--window-size=1920,1080','--window-position=0,0','--force-device-scale-factor=1']});
    console.log('Capture browser ready');
    process.once('SIGTERM',()=>browser.close().finally(()=>process.exit(0)));`;
  captureContainer = await new GenericContainer(image)
    .withBindMounts([{ source: '/tmp/.X11-unix', target: '/tmp/.X11-unix', mode: 'ro' }])
    .withEnvironment({ DISPLAY: `:${displayNumber}`, APP_PORT: new URL(env.base).port, BROWSER_WS_PATH: wsPath })
    .withExtraHosts([{ host: 'host.docker.internal', ipAddress: 'host-gateway' }])
    .withCopyContentToContainer([{ content: launcher, target: '/opt/browser/capture.mjs' }])
    .withCommand(['node', 'capture.mjs']).withExposedPorts(3000)
    .withSharedMemorySize(1024 * 1024 * 1024)
    .withWaitStrategy(Wait.forLogMessage('Capture browser ready')).withStartupTimeout(30000).start();
  captureBrowser = await chromium.connect(`ws://${captureContainer.getHost()}:${captureContainer.getMappedPort(3000)}${wsPath}`);
  context = await captureBrowser.newContext({ viewport: { width: 1920, height: 1080 } });
  await context.addInitScript(() => {
    if (!localStorage.getItem('smoke-token')) localStorage.setItem('smoke-token', 'alice-token');
    if (!localStorage.getItem('share-tally-scheme')) localStorage.setItem('share-tally-scheme', 'light');
  });
  await context.route('**/demo-stage', route => route.fulfill({ contentType: 'text/html', body: stageHTML() }));
  const page = await context.newPage();
  page.on('pageerror', error => { errors.push(error.message); console.error('PAGEERROR', error.message); });
  page.on('console', msg => { if(msg.type()==='error') console.error('CONSOLE',msg.text()); });
  await page.goto(`${env.base}demo-stage`);
  const cdp = await context.newCDPSession(page);
  const { windowId } = await cdp.send('Browser.getWindowForTarget');
  await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'fullscreen' } });
  await page.locator('#app').evaluate((element, url) => { element.src = url; }, billsUrl);
  const alice = page.frame({ name: 'app' });
  assert.ok(alice);
  await expect(groupNet(alice)).toContainText('$30.00', { timeout: 15000 });
  async function ready() {
    await page.evaluate(() => document.fonts.ready);
    await alice.evaluate(() => document.fonts.ready);
    await alice.waitForFunction(() => [...document.images].every(image => image.complete && image.naturalWidth > 0));
    await expect(alice.locator('vite-error-overlay')).toHaveCount(0);
    await expect(alice.locator('[role="alert"]')).toHaveCount(0);
    await alice.addStyleTag({ content: '*{cursor:none!important}html{scroll-behavior:smooth}::-webkit-scrollbar{display:none}' });
    await pause(200);
  }
  let cursor = { x: 180, y: 120 };
  async function move(x, y, ms = 450) {
    await page.evaluate(async ({ from, x, y, ms }) => {
      const pointer = document.querySelector('#cursor');
      await new Promise(resolve => {
        const start = performance.now();
        function tick(now) {
          const t = Math.min(1, (now - start) / ms), eased = t * t * (3 - 2 * t);
          pointer.style.transform = `translate(${from.x + (x - from.x) * eased}px,${from.y + (y - from.y) * eased}px)`;
          if (t < 1) requestAnimationFrame(tick); else resolve();
        }
        requestAnimationFrame(tick);
      });
    }, { from: cursor, x, y, ms });
    cursor = { x, y }; await page.mouse.move(x, y);
  }
  async function aim(locator, ms = 450) {
    let box = await locator.boundingBox();
    assert.ok(box, 'Visible interaction target');
    if (box.y < 40 || box.y + box.height > 944) {
      await locator.evaluate(element => element.scrollIntoView({ behavior: 'smooth', block: 'center' }));
      await pause(750); box = await locator.boundingBox();
    }
    await move(box.x + box.width / 2, box.y + box.height / 2, ms);
  }
  async function click(locator, ms = 450, after = 250) {
    await aim(locator, ms);
    await page.evaluate(({ x, y }) => {
      const ripple = document.querySelector('#ripple');
      ripple.style.left = `${x - 22}px`; ripple.style.top = `${y - 22}px`;
      ripple.animate([{ opacity: .7, transform: 'scale(.35)' }, { opacity: 0, transform: 'scale(1.3)' }], { duration: 500 });
    }, cursor);
    await page.mouse.click(cursor.x, cursor.y); await pause(after);
  }
  async function type(locator, text) {
    await click(locator); await locator.press('ControlOrMeta+A');
    await locator.pressSequentially(text, { delay: 65 });
  }
  async function scroll(y) {
    await alice.evaluate(y => window.scrollTo({ top: y, behavior: 'smooth' }), y);
    await pause(850);
  }
  let timeline = 0;
  const clips = [];
  async function scene(name, action = async () => {}, mode = 'app') {
    const [, seconds, caption] = scenes.find(scene => scene[0] === name);
    await page.evaluate(({ caption, mode }) => window.setScene(caption, mode), { caption, mode });
    await ready();
    const raw = join(work, `${name}.mkv`);
    recorder = spawn('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'x11grab', '-framerate', '30', '-video_size', '1920x1080', '-draw_mouse', '0', '-i', `:${displayNumber}.0`, '-an', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '0', raw], { stdio: ['ignore', 'ignore', 'pipe'] });
    let failure = '';
    recorder.stderr.on('data', data => { failure += data; });
    const started = performance.now();
    await pause(250); console.log(`Recording ${timeline}–${timeline + seconds}s: ${name}`);
    await action();
    const elapsed = performance.now() - started;
    assert.ok(elapsed < seconds * 1000, `${name} actions exceed ${seconds}s (${elapsed}ms)`);
    await pause(seconds * 1000 - elapsed + 250);
    await stop(recorder); recorder = undefined;
    assert.equal(failure, '', `Recording failed: ${failure}`);
    const clip = join(work, `${name}.mp4`);
    await command('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', raw, '-vf', 'fps=30,tpad=stop_mode=clone:stop_duration=1', '-t', String(seconds), '-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', '-video_track_timescale', '15360', clip]);
    await command('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-ss', '1', '-i', clip, '-frames:v', '1', join(output, `scene-${name}.png`)]);
    clips.push(clip); timeline += seconds;
  }
  await scene('title', undefined, 'card');
  await scene('group', async () => { await move(1220, 415); await pause(900); await scroll(420); await pause(700); await scroll(0); });
  await click(alice.getByRole('button', { name: 'New bill', exact: true }));
  await expect(alice.getByRole('heading', { name: 'How do you want to split it?' })).toBeVisible();
  await scene('scan', async () => {
    await aim(alice.getByRole('button', { name: 'Choose a photo', exact: true }));
    await alice.getByLabel('Choose a receipt image').setInputFiles({ name: 'fictional-receipt.png', mimeType: 'image/png', buffer: photo });
    await expect(alice.getByRole('dialog', { name: 'Just the receipt' })).toBeVisible();
    await pause(1100); await aim(alice.getByRole('button', { name: 'Use this photo', exact: true }));
  });
  // Cut the processing wait, but run the real upload/provider lifecycle. Replace
  // its generic test result through the public draft API with the fictional
  // extraction/evidence used for README captures; never contact real AI services.
  await click(alice.getByRole('button', { name: 'Use this photo', exact: true }));
  await expect(alice.getByRole('heading', { name: 'Check your items' })).toBeVisible();
  const [{ id: draftId }] = (await env.api(`/groups/${group.id}/receipt-drafts`)).drafts;
  const { draft: extracted } = await env.api(`/receipt-drafts/${draftId}`);
  const data = {
    mode: 'items', title: 'Shared shopping', purchaseDate: '2026-10-10', timeZone: 'America/Toronto', notes: '', totalCents: 2930, participantIds: participants,
    receipt: { subtotalCents: 2800, discountCents: 0, taxCents: 130, extraCents: 0, pricesIncludeTax: false, evidence: { pages: [{ pageNumber: 1, width: 480, height: 620, unit: 'pixel' }], taxDetails: [{ rate: .13 }] } },
    items: rows.map(([name, amountCents], index) => ({
      id: randomUUID(), name, originalText: name.toUpperCase(), quantity: '1', amountCents, discountCents: 0, taxable: index === 3,
      finalCents: amountCents + (index === 3 ? 130 : 0), manualFinal: false,
      evidence: { regions: [{ pageNumber: 1, polygon: [25, 200 + index * 52, 455, 200 + index * 52, 455, 232 + index * 52, 25, 232 + index * 52] }] },
    })),
  };
  await env.api(`/groups/${group.id}/receipt-drafts/${draftId}`, 'alice-token', 'PUT', { revision: extracted.revision, data });
  await alice.goto(`${env.base}#/new-bill/${group.id}/${draftId}`);
  await alice.getByRole('navigation', { name: 'New bill steps' }).getByRole('button', { name: /Items$/ }).click();
  await scroll(380);
  await scene('review', async () => {
    await move(950, 430); await pause(850);
    await click(alice.getByRole('button', { name: 'Edit Dish soap', exact: true })); await pause(750);
    await click(alice.getByRole('button', { name: 'Close editor', exact: true }));
    await click(alice.getByRole('button', { name: 'Continue to sharing', exact: true }));
  });
  await scene('sharing', async () => { await move(1130, 400); await pause(500); await click(alice.getByRole('button', { name: 'Share bill', exact: true })); });
  await expect(alice.getByRole('heading', { name: 'Items & claims' })).toBeVisible();
  const billId = alice.url().split('/').at(-1);
  const view = name => alice.getByRole('button', { name: new RegExp(`^View ${name} ·`) });
  await click(view('Dish soap'));
  await aim(alice.getByRole('button', { name: 'All of it · $11.30', exact: true }));
  await scene('whole', async () => {
    await pause(700); await click(alice.getByRole('button', { name: 'All of it · $11.30', exact: true }));
  });
  const wholeClose = alice.getByRole('button', { name: 'Close claim', exact: true });
  if (await wholeClose.isVisible()) await click(wholeClose);
  await click(view('Apples'));
  await aim(alice.getByRole('button', { name: 'Even · 1/3 · $2.00', exact: true }));
  await scene('fraction', async () => {
    await pause(600);
    await click(alice.getByRole('button', { name: 'Even · 1/3 · $2.00', exact: true }), 450, 80);
    // Return to the list, then leave a reading pause on the selected fraction
    // before confirming it.
    await click(alice.getByRole('button', { name: 'Close claim', exact: true }), 250, 100);
    await scroll(330); await pause(2200);
    await click(alice.getByRole('button', { name: 'Confirm my item claims', exact: true }));
  });
  await expect(alice.locator('.claim-list')).toContainText('Your claim');
  const notice = alice.getByRole('button', { name: 'Dismiss notification', exact: true });
  if (await notice.isVisible()) await notice.click();
  await scroll(330);
  const bob = await env.pageFor('bob-token', { width: 1440, height: 1000 });
  await bob.goto(`${env.base}#/bills/${billId}`);
  await bob.getByRole('button', { name: /^View Apples ·/ }).click();
  await bob.getByRole('button', { name: 'Even · 1/3 · $2.00', exact: true }).click();
  const bobClose = bob.getByRole('button', { name: 'Close claim', exact: true });
  if (await bobClose.isVisible()) await bobClose.click();
  await scene('live', async () => {
    await pause(700); await bob.getByRole('button', { name: 'Confirm my item claims', exact: true }).click();
    await expect(view('Apples').getByRole('img', { name: /1\/3 claimed by others/ })).toHaveCount(1); await move(1070, 520); await pause(700);
    await click(view('Apples'));
    const sheet = alice.getByRole('dialog', { name: 'Apples', exact: true });
    await expect(sheet).toContainText('Bob');
    await sheet.locator('.claim-portion').evaluate(element => element.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    await pause(600);
  });
  // Switch the test identity off camera. Carol's real UI records the transfer.
  await alice.evaluate(() => localStorage.setItem('smoke-token', 'carol-token'));
  await alice.goto(billsUrl.replace('/#', '/?demo-view=carol#'));
  await alice.getByRole('button', { name: 'Record repayment', exact: true }).click();
  await alice.getByLabel('Recipient', { exact: true }).selectOption({ label: 'Alice' });
  await scene('record', async () => {
    await type(alice.getByLabel('Amount sent · CAD'), '15.00'); await pause(600);
    await click(alice.getByRole('button', { name: 'Record transfer', exact: true }));
  });
  await alice.evaluate(() => localStorage.setItem('smoke-token', 'alice-token'));
  await alice.goto(billsUrl.replace('/#', '/?demo-view=alice#'));
  await expect(groupNet(alice)).toContainText('$30.00');
  await alice.getByRole('button', { name: 'Review repayment', exact: true }).click();
  await scene('confirm', async () => {
    await pause(1100); await click(alice.getByRole('button', { name: 'Confirm receipt', exact: true }));
    await scroll(0); await expect(groupNet(alice)).toContainText('$15.00'); await move(1140, 400);
  });
  assert.equal((await env.api(`/groups/${group.id}/bills`)).repayments[0].status, 'confirmed');
  await alice.getByRole('button', { name: 'Account menu', exact: true }).click();
  await alice.getByRole('menuitem', { name: 'Account', exact: true }).click();
  await alice.getByRole('radiogroup', { name: 'Mode' }).getByRole('radio', { name: 'Dark', exact: true }).check();
  await alice.goto(`${env.base}#/bills/${billId}`);
  await expect.poll(() => alice.evaluate(() => document.documentElement.dataset.scheme)).toBe('dark');
  await scene('dark', async () => { await move(1210, 450); await scroll(200); });
  await alice.evaluate(() => localStorage.setItem('share-tally-scheme', 'light'));
  await alice.goto(billsUrl.replace('/#', '/?demo-view=mobile#'));
  await scene('mobile', async () => {
    assert.equal(await alice.evaluate(() => innerWidth), 390);
    assert.ok(await alice.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await move(1420, 440); await pause(450); await scroll(380);
  }, 'mobile');
  await scene('end', async () => { await page.evaluate(() => { document.querySelector('#tagline').innerHTML = 'Everyone’s share.<br>Fairly settled.'; }); }, 'card');
  assert.equal(timeline, 60); assert.deepEqual(errors, []); assert.deepEqual(env.errors, []);
  assert.equal(env.networkChangeFailures.size, 0);
  let start = 0;
  const stamp = seconds => `00:${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')},000`;
  const srt = scenes.map(([, duration, caption], index) => {
    const result = `${index + 1}\n${stamp(start)} --> ${stamp(start + duration)}\n${caption}\n`;
    start += duration; return result;
  }).join('\n');
  await writeFile(join(output, 'sharetally-demo-v1.srt'), srt);
  await writeFile(join(work, 'concat.txt'), clips.map(path => `file '${path}'`).join('\n'));
  const video = join(output, 'sharetally-demo-v1.mp4');
  await command('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', join(work, 'concat.txt'), '-c', 'copy', '-movflags', '+faststart', video]);
  await command('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-ss', '4', '-i', video, '-frames:v', '1', join(output, 'poster.png')]);
  await command('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', video, '-vf', 'select=not(mod(n\\,150))', '-fps_mode', 'vfr', join(output, 'frames', 'frame-%02d.png')]);
  const probe = await command('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,width,height,r_frame_rate,pix_fmt:format=duration,size', '-of', 'json', video]);
  const metadata = JSON.parse(probe), stream = metadata.streams[0];
  assert.equal(stream.codec_name, 'h264'); assert.equal(stream.width, 1920); assert.equal(stream.height, 1080);
  assert.equal(stream.r_frame_rate, '30/1'); assert.equal(stream.pix_fmt, 'yuv420p');
  assert.ok(Number(metadata.format.duration) >= 58 && Number(metadata.format.duration) <= 62);
  assert.ok(Number(metadata.format.size) < 40_000_000);
  await writeFile(join(output, 'ffprobe.json'), probe);
  await writeFile(join(output, 'scenes.json'), JSON.stringify(scenes, null, 2));
  console.log(probe); console.log(`Video, captions, poster and review frames: ${output}`);
} finally {
  await context?.pages()[0]?.screenshot({path:join(output,'debug.png')}).catch(() => {});
  await stop(recorder); await context?.close(); await captureBrowser?.close();
  await captureContainer?.stop(); await stop(display); await env?.dispose();
  await rm(work, { recursive: true, force: true });
}

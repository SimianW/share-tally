// Public HTTP checks through the real production template and official entrypoint.
// Needs Docker: node --test test/browser/nginx.test.mjs
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { get } from 'node:http';
import { isIP } from 'node:net';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { GenericContainer, Network, Wait } from 'testcontainers';

const deploy = new URL('../../../deploy/', import.meta.url);
const nginxImage = 'public.ecr.aws/docker/library/nginx:1.28-alpine';
const apiImage = 'public.ecr.aws/docker/library/node:24-bookworm-slim';
const apiScript = `
  require('node:http').createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify(request.url === '/api/forwarded' ? request.headers : {
      marker: process.env.MARKER, url: request.url, method: request.method, body,
    }));
  }).listen(3000, '0.0.0.0', () => console.log('listening'));
`;

async function fixture(t) {
  const cleanup = [];
  t.after(async () => {
    while (cleanup.length) await cleanup.pop()();
  });
  const network = await new Network().start();
  cleanup.push(() => network.stop());
  return {
    async api(alias, marker) {
      const api = await new GenericContainer(apiImage)
        .withNetwork(network).withNetworkAliases(alias)
        .withEnvironment({ MARKER: marker })
        .withCommand(['node', '-e', apiScript])
        .withWaitStrategy(Wait.forLogMessage('listening')).start();
      let stopping;
      const stop = () => stopping ??= api.stop();
      cleanup.push(stop);
      return { ip: api.getIpAddress(network.getName()), stop };
    },
    async web(environment = {}) {
      const scripts = (await readdir(deploy)).filter(name => name.endsWith('.envsh'));
      const files = await Promise.all(scripts.map(async name => ({
        content: await readFile(new URL(name, deploy), 'utf8'), target: `/docker-entrypoint.d/${name}`, mode: 0o755,
      })));
      const web = await new GenericContainer(nginxImage)
        .withNetwork(network).withEnvironment(environment)
        .withCopyContentToContainer([
          { content: await readFile(new URL('nginx.conf', deploy), 'utf8'), target: '/etc/nginx/templates/default.conf.template' },
          { content: await readFile(new URL('nginx-static-headers.conf', deploy), 'utf8'), target: '/etc/nginx/static-headers.conf' },
          ...files,
        ])
        .withExposedPorts(80).withWaitStrategy(Wait.forHttp('/index.html', 80)).start();
      cleanup.push(() => web.stop());
      return { container: web, base: `http://${web.getHost()}:${web.getMappedPort(80)}` };
    },
  };
}

test('proxy headers preserve the host, protocol and forwarded client chain', async t => {
  const env = await fixture(t);
  await env.api('api', 'compose');
  // These are Nginx variables, not deployment settings. Runtime rendering must
  // not substitute them even if the environment happens to contain these names.
  const web = await env.web({ host: 'wrong.example', scheme: 'wrong' });
  // Node's HTTP client permits an explicit Host header; fetch does not.
  const response = await new Promise((resolve, reject) => {
    get(`${web.base}/api/forwarded`, {
      headers: { Host: 'sharetally.test', 'X-Forwarded-For': '192.0.2.44' },
    }, resolve).on('error', reject);
  });
  assert.equal(response.statusCode, 200);
  let body = '';
  for await (const chunk of response) body += chunk;
  const headers = JSON.parse(body);
  assert.equal(headers.host, 'sharetally.test');
  assert.equal(headers['x-forwarded-proto'], 'http');
  const forwarded = headers['x-forwarded-for'].split(',').map(value => value.trim());
  assert.equal(forwarded[0], '192.0.2.44');
  assert.equal(forwarded.length, 2);
  assert.ok(isIP(forwarded[1]), 'The proxy appends the connected client address');
});

test('API replacement at a different IP recovers without restarting Nginx', { timeout: 40_000 }, async t => {
  const env = await fixture(t);
  const original = await env.api('api', 'original');
  const web = await env.web();
  assert.equal((await (await fetch(`${web.base}/api/probe`)).json()).marker, 'original');
  await original.stop();
  // Occupy the freed address so Docker cannot silently reuse it for the replacement.
  await env.api('vacated-address', 'not-the-api');
  const replacement = await env.api('api', 'replacement');
  assert.notEqual(replacement.ip, original.ip, 'The experiment must actually change the upstream IP');
  const deadline = Date.now() + 20_000;
  let observed;
  while (Date.now() < deadline) {
    const response = await fetch(`${web.base}/api/probe`, { signal: AbortSignal.timeout(1000) });
    observed = response.ok ? (await response.json()).marker : `HTTP ${response.status}`;
    if (observed === 'replacement') break;
    await delay(250);
  }
  assert.equal(observed, 'replacement', 'The same running Nginx must follow the API hostname to its new address');
});

test('a configured upstream receives API requests instead of the Compose default', async t => {
  const env = await fixture(t);
  await env.api('api', 'compose');
  await env.api('api.railway.internal', 'railway');
  const web = await env.web({ API_UPSTREAM: 'api.railway.internal:3000' });
  const response = await fetch(`${web.base}/api/health?probe=custom`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    marker: 'railway', url: '/api/health?probe=custom', method: 'GET', body: '',
  });
});

test('the default upstream forwards the original API URI, method and body', async t => {
  const env = await fixture(t);
  await env.api('api', 'compose');
  const web = await env.web();
  const response = await fetch(`${web.base}/api/items/a%2Fb?name=rice%20bag&tag=a&tag=b`, {
    method: 'POST', body: 'original body',
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    marker: 'compose', url: '/api/items/a%2Fb?name=rice%20bag&tag=a&tag=b', method: 'POST', body: 'original body',
  });
});

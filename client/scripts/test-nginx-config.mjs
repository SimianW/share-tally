import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { nginxTestConfig } from '../test/browser/nginx-config.mjs';

const deployConfig = await readFile(new URL('../../deploy/nginx.conf', import.meta.url), 'utf8');
const locations = config => [...config.matchAll(/^\s*location\s+([^{]+?)\s*\{/gm)].map(([, target]) => target);

test('the browser-test Nginx config keeps production API proxying and sends everything else to Vite', () => {
  const config = nginxTestConfig(deployConfig, 5173);
  assert.deepEqual(locations(config), ['/api/', '/']);
  const api = config.slice(config.indexOf('location /api/'), config.indexOf('location / {'));
  assert.match(api, /proxy_pass http:\/\/host\.docker\.internal:5173;/);
  assert.match(api, /proxy_buffering off;/);
  assert.match(api, /proxy_read_timeout 180s;/);
  assert.match(config, /upstream test_vite \{ server host\.docker\.internal:5173;/);
  assert.match(config, /client_max_body_size 12m;/);
  assert.doesNotMatch(config, /api:3000|try_files/);
});

test('the Vite location goes inside the server block even when another block follows it', () => {
  const config = nginxTestConfig('server {\n    listen 80;\n    location /api/ { proxy_pass http://api:3000; }\n}\nupstream later { server example:1; }\n', 5173);
  assert.match(config, /location \/ \{[^}]*\}\n\}\nupstream later \{ server example:1; \}\n$/);
});

test('a deploy config without the API location is rejected', () => {
  assert.throws(() => nginxTestConfig('server {\n    listen 80;\n    location / { try_files $uri /index.html; }\n}\n', 5173), /location \/api\//);
});

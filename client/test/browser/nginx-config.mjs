// The Nginx config for the SSE soak scenarios: production's server settings
// and /api/ proxy, pointed at the test API. Every other production location
// serves built files, which tests do not have; Vite serves those paths instead.
// Proxy the test-only Clerk bundle and the dev modules through one upstream.
export function nginxTestConfig(deployConfig, vitePort) {
  const vite = `host.docker.internal:${vitePort}`;
  let config = deployConfig;
  for (const { target, start, end } of serverLocations(deployConfig).reverse())
    if (target !== '/api/') config = config.slice(0, start) + config.slice(end);
  if (!serverLocations(config).length || !config.includes('http://api:3000'))
    throw new Error('deploy/nginx.conf needs a location /api/ block proxying to http://api:3000');
  config = config.replace('http://api:3000', `http://${vite}`);
  // Vite serves thousands of development modules instead of built assets.
  // Reuse its upstream sockets while still allowing its HMR upgrade.
  const upstream = `upstream test_vite { server ${vite}; keepalive 64; }\nmap $http_upgrade $test_connection { default upgrade; '' ''; }\n`;
  const location = `    location / {
        proxy_pass http://test_vite;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $test_connection;
    }
`;
  const close = config.lastIndexOf('}');
  return upstream + config.slice(0, close) + location + config.slice(close);
}

// Location blocks directly inside the server block, with their full extent.
function serverLocations(config) {
  const code = config.replace(/#[^\n]*/g, comment => ' '.repeat(comment.length));
  const depthAt = index => [...code.slice(0, index)].reduce((depth, char) => depth + (char === '{') - (char === '}'), 0);
  return [...code.matchAll(/^[ \t]*location\s+([^{]+?)\s*\{/gm)].filter(match => depthAt(match.index) === 1).map(match => {
    let depth = 0, end = match.index;
    do {
      if (code[end] === '{') depth++;
      if (code[end] === '}') depth--;
      end++;
    } while (depth > 0 || code[end - 1] !== '}');
    if (code[end] === '\n') end++;
    return { target: match[1], start: match.index, end };
  });
}

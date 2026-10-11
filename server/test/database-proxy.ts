import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createConnection, createServer, type Socket } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';

// The API reaches PostgreSQL only through this proxy, so a test can make the
// database refuse connections, accept them and never answer, or keep
// established connections open while ignoring their queries.
export type DatabaseState = 'up' | 'refusing' | 'silent' | 'stalled';

// PostgreSQL's untyped requests that precede, rather than start, a session.
const SSL_REQUEST = 80877103;
const GSSENC_REQUEST = 80679877;

export async function startDatabaseProxy(host: string, port: number) {
  let state: DatabaseState = 'up';
  // Connection attempts and protocol messages from the API, other than
  // Terminate: closing an idle pooled connection is not database work.
  let traffic = 0;
  const sockets = new Set<Socket>();
  function track(socket: Socket) {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    socket.on('error', () => {});
  }
  function count(client: Socket) {
    let buffered = Buffer.alloc(0);
    let started = false;
    client.on('data', (chunk: Buffer) => {
      buffered = Buffer.concat([buffered, chunk]);
      while (true) {
        if (!started) {
          if (buffered.length < 8) return;
          const length = buffered.readInt32BE(0);
          if (buffered.length < length) return;
          const code = buffered.readInt32BE(4);
          started = code !== SSL_REQUEST && code !== GSSENC_REQUEST;
          traffic++;
          buffered = buffered.subarray(length);
        } else {
          if (buffered.length < 5) return;
          const length = 1 + buffered.readInt32BE(1);
          if (buffered.length < length) return;
          if (buffered[0] !== 'X'.charCodeAt(0)) traffic++;
          buffered = buffered.subarray(length);
        }
      }
    });
  }
  const server = createServer(client => {
    track(client);
    traffic++;
    if (state === 'refusing') { client.destroy(); return; }
    count(client);
    if (state === 'silent') return;
    const upstream = createConnection({ host, port });
    track(upstream);
    client.on('data', chunk => { if (state !== 'stalled') upstream.write(chunk); });
    upstream.pipe(client);
    client.once('close', () => upstream.destroy());
    upstream.once('close', () => client.destroy());
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return {
    // The given connection URI, rewritten to reach the database through this proxy.
    url(connectionUri: string) {
      const url = new URL(connectionUri);
      url.hostname = '127.0.0.1';
      url.port = String(address.port);
      return url.toString();
    },
    set(next: DatabaseState) {
      state = next;
      // Existing pooled connections fail too, as they would in a real outage.
      if (next === 'refusing' || next === 'silent') for (const socket of sockets) socket.destroy();
    },
    // Counts traffic since the checkpoint was taken.
    checkpoint() {
      const start = traffic;
      return () => traffic - start;
    },
    // Traffic the API sends while the test waits.
    async trafficDuring(ms: number) {
      const since = this.checkpoint();
      await sleep(ms);
      return since();
    },
    close() {
      for (const socket of sockets) socket.destroy();
      server.close();
    },
  };
}

export type DatabaseProxy = Awaited<ReturnType<typeof startDatabaseProxy>>;

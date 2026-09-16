import type { Response } from 'express';

// One API process. Notify only AFTER the database transaction resolves.
// Events invalidate a group's view; they never carry financial state.
const subscribers = new Map<string, Set<Response>>();
export function notifyGroupChanged(groupId: string) {
  for (const response of subscribers.get(groupId) ?? []) {
    // A slow reader reconnects and fetches a snapshot instead of buffering history.
    if (!response.write('event: changed\ndata: {}\n\n')) response.destroy();
  }
}

export function openGroupEvents(groupId: string, response: Response, expiresAt: number) {
  response.setHeader('Content-Type', 'text/event-stream');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Accel-Buffering', 'no');
  const group = subscribers.get(groupId) ?? new Set<Response>();
  group.add(response);
  subscribers.set(groupId, group);
  const heartbeat = setInterval(() => {
    if (!response.write(': heartbeat\n\n')) response.destroy();
  }, 10_000);
  // Reauthenticate regularly, and never keep a stream past its verified JWT expiry.
  const expiry = setTimeout(() => response.end(), Math.max(0, expiresAt - Date.now()));
  response.once('close', () => {
    clearInterval(heartbeat);
    clearTimeout(expiry);
    group.delete(response);
    if (!group.size) subscribers.delete(groupId);
  });
  response.write('event: ready\ndata: {}\n\n');
}

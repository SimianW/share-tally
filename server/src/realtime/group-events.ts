import type { Response } from 'express';
import { randomUUID } from 'node:crypto';

// One API process. Notify only AFTER the database transaction resolves.
// Events invalidate a group's view; they never carry financial state.
const subscribers = new Map<string, Set<Response>>();
// Member streams, by user ID, invalidate views spanning a member's groups, such as Home.
// Each member's version counts their announcements, so a reconnecting reader
// rereads only if it missed one. A restart changes every version.
const memberSubscribers = new Map<string, Set<Response>>();
const started = randomUUID();
const memberChanges = new Map<string, number>();
const memberVersion = (userId: string) => JSON.stringify({ version: `${started}:${memberChanges.get(userId) ?? 0}` });

function changed(streams: Map<string, Set<Response>>, key: string, data = '{}') {
  for (const response of streams.get(key) ?? []) {
    // A slow reader reconnects and fetches a snapshot instead of buffering history.
    if (!response.write(`event: changed\ndata: ${data}\n\n`)) response.destroy();
  }
}

export function notifyGroupChanged(groupId: string) {
  changed(subscribers, groupId);
}

export function notifyMembersChanged(userIds: string[]) {
  for (const userId of userIds) {
    memberChanges.set(userId, (memberChanges.get(userId) ?? 0) + 1);
    changed(memberSubscribers, userId, memberVersion(userId));
  }
}

export function notifyGroupDeleted(groupId: string, name: string) {
  for (const response of subscribers.get(groupId) ?? []) {
    // end(data) queues the final event before the stream's EOF, even under backpressure.
    response.end(`event: group-deleted\ndata: ${JSON.stringify({ id: groupId, name })}\n\n`);
  }
}

function openEvents(streams: Map<string, Set<Response>>, key: string, response: Response, expiresAt: number, ready = '{}') {
  response.setHeader('Content-Type', 'text/event-stream');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Accel-Buffering', 'no');
  const group = streams.get(key) ?? new Set<Response>();
  group.add(response);
  streams.set(key, group);
  const heartbeat = setInterval(() => {
    if (!response.write(': heartbeat\n\n')) response.destroy();
  }, 10_000);
  // Reauthenticate regularly, and never keep a stream past its verified JWT expiry.
  const renewal = setTimeout(() => {
    if (!response.write(`event: renew\ndata: ${JSON.stringify({ expiresAt })}\n\n`)) response.destroy();
  }, Math.max(0, expiresAt - Date.now() - 5000));
  const expiry = setTimeout(() => response.end(), Math.max(0, expiresAt - Date.now()));
  response.once('close', () => {
    clearInterval(heartbeat);
    clearTimeout(expiry);
    clearTimeout(renewal);
    group.delete(response);
    if (!group.size) streams.delete(key);
  });
  response.write(`event: ready\ndata: ${JSON.stringify({ ...JSON.parse(ready), expiresAt, expiresInMs: Math.max(0, expiresAt - Date.now()) })}\n\n`);
}

export function openGroupEvents(groupId: string, response: Response, expiresAt: number) {
  openEvents(subscribers, groupId, response, expiresAt);
}

export function openMemberEvents(userId: string, response: Response, expiresAt: number) {
  openEvents(memberSubscribers, userId, response, expiresAt, memberVersion(userId));
}

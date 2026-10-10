import type { AvatarReader, AvatarImages } from "../identity/avatars.js";
import { Router } from 'express';
import { getGroupUser } from '../identity/users.js';
import { deleteGroup } from '../workflows/delete-group.js';
import { departureEligibility, leaveGroup, removeMember } from '../workflows/end-membership.js';
import { parseGroupIcon } from './group-icon.js';
import { createGroup, getGroupForMember, groupDeletionEligibility, groupInvitation, joinGroup, listGroupsForUser } from './groups.js';
import type { ProfileReader } from '../identity/clerk-profiles.js';

export function createGroupsRouter(profiles: ProfileReader, avatars: AvatarReader) {
  const router = Router();
  type Listed = { id: string };
  const memberIds = (group: { ownerId: string; members?: Listed[]; memberPreview?: Listed[] }) =>
    [group.ownerId, ...(group.members ?? []).map(m => m.id), ...(group.memberPreview ?? []).map(m => m.id)];
  async function withAvatars<T extends { ownerId: string; members?: Listed[]; memberPreview?: Listed[] }>(group: T, knownImages?: Map<string, AvatarImages | null>) {
    const images = knownImages ?? await avatars(memberIds(group));
    const withImages = <M extends Listed>(member: M) => ({ ...member, imageUrl: images.get(member.id)?.imageUrl ?? null,
      fallbackImageUrl: images.get(member.id)?.fallbackImageUrl ?? null });
    return { ...group, ownerImageUrl: images.get(group.ownerId)?.imageUrl ?? null,
      ownerFallbackImageUrl: images.get(group.ownerId)?.fallbackImageUrl ?? null,
      ...(group.members ? { members: group.members.map(m => ({ ...m, ...images.get(m.id) })) } : {}),
      ...(group.memberPreview ? { memberPreview: group.memberPreview.map(withImages) } : {}),
    };
  }
  const currentUser = (clerkUserId: string) => getGroupUser(clerkUserId, profiles);

  router.get('/', async (_req, res) => {
    const user = await currentUser(res.locals.clerkUserId);
    const groups = await listGroupsForUser(user.id);
    const images = await avatars(groups.flatMap(memberIds));
    res.json({ groups: await Promise.all(groups.map(group => withAvatars(group, images))) });
  });

  router.post('/', async (req, res) => {
    const body: unknown = req.body;
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      res.status(400).json({ error: 'Expected a JSON object.' }); return;
    }
    if (!('name' in body) || typeof body.name !== 'string' || !('icon' in body)) {
      res.status(400).json({ error: 'A string name and an icon are required.' }); return;
    }
    const name = body.name.trim();
    if (name.length < 1 || name.length > 40 || /\p{Cc}/u.test(name)) {
      res.status(400).json({ error: 'Group name must contain 1 to 40 characters without control characters.' }); return;
    }
    const icon = parseGroupIcon(body.icon);
    const user = await currentUser(res.locals.clerkUserId);
    res.status(201).json({ group: await withAvatars(await createGroup(user.id, { name, icon })) });
  });

  router.post('/join', async (req, res) => {
    const body: unknown = req.body;
    if (typeof body !== 'object' || body === null || !('token' in body) ||
      typeof body.token !== 'string' || !/^[0-9a-f]{64}$/.test(body.token)) {
      res.status(404).json({ error: 'This invitation is invalid or has been replaced.' }); return;
    }
    const user = await currentUser(res.locals.clerkUserId);
    res.json({ group: await withAvatars(await joinGroup(body.token, user.id)) });
  });

  const uuid = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
  router.param('groupId', (_req, res, next, id: string) => {
    if (!uuid.test(id)) {
      res.status(404).json({ error: 'Group not found.' }); return;
    }
    next();
  });

  router.get('/:groupId', async (req, res) => {
    const user = await currentUser(res.locals.clerkUserId);
    res.json({ group: await withAvatars(await getGroupForMember(req.params.groupId, user.id)) });
  });

  router.get('/:groupId/deletion', async (req, res) => {
    const user = await currentUser(res.locals.clerkUserId);
    res.json(await groupDeletionEligibility(req.params.groupId, user.id));
  });

  router.delete('/:groupId', async (req, res) => {
    const user = await currentUser(res.locals.clerkUserId);
    await deleteGroup(req.params.groupId, user.id);
    res.json({ deleted: true });
  });

  router.post('/:groupId/leave', async (req, res) => {
    const body: unknown = req.body ?? {};
    if (typeof body !== 'object' || body === null || Array.isArray(body) ||
      Object.keys(body).some(key => key !== 'successorId') ||
      ('successorId' in body && (typeof body.successorId !== 'string' || !uuid.test(body.successorId)))) {
      res.status(400).json({ error: 'Send only the new owner, if you are the group owner.' }); return;
    }
    const successorId = 'successorId' in body ? String(body.successorId).toLowerCase() : undefined;
    const user = await currentUser(res.locals.clerkUserId);
    await leaveGroup(req.params.groupId, user.id, successorId);
    res.json({ left: true });
  });

  router.param('userId', (_req, res, next, id: string) => {
    if (!uuid.test(id)) { res.status(404).json({ error: 'Member not found.' }); return; }
    next();
  });

  router.get('/:groupId/members/:userId/departure', async (req, res) => {
    const user = await currentUser(res.locals.clerkUserId);
    res.json(await departureEligibility(req.params.groupId, user.id, req.params.userId.toLowerCase()));
  });

  router.delete('/:groupId/members/:userId', async (req, res) => {
    const user = await currentUser(res.locals.clerkUserId);
    await removeMember(req.params.groupId, user.id, req.params.userId.toLowerCase());
    res.json({ removed: true });
  });

  router.get('/:groupId/invitation', async (req, res) => {
    const user = await currentUser(res.locals.clerkUserId);
    res.json(await groupInvitation(req.params.groupId, user.id, false));
  });

  router.post('/:groupId/invitation', async (req, res) => {
    const user = await currentUser(res.locals.clerkUserId);
    res.json(await groupInvitation(req.params.groupId, user.id, true));
  });

  return router;
}

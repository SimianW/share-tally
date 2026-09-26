import type { AvatarReader, AvatarImages } from "./avatars.js";
import { Router } from 'express';
import { getGroupUser } from './users.js';
import { parseGroupIcon } from './group-icon.js';
import { createGroup, deleteGroup, getGroupForMember, groupDeletionEligibility, groupInvitation, joinGroup, listGroupsForUser } from './groups.js';

export function createGroupsRouter(displayName: (id: string) => Promise<string>, avatars: AvatarReader) {
  const router = Router();
  async function withAvatars<T extends { createdBy: string; members?: { id: string }[] }>(group: T, knownImages?: Map<string, AvatarImages | null>) {
    const images = knownImages ?? await avatars([group.createdBy, ...(group.members ?? []).map(m => m.id)]);
    return { ...group, creatorImageUrl: images.get(group.createdBy)?.imageUrl ?? null,
      creatorFallbackImageUrl: images.get(group.createdBy)?.fallbackImageUrl ?? null,
      ...(group.members ? { members: group.members.map(m => ({ ...m, ...images.get(m.id) })) } : {}),
    };
  }
  const currentUser = (clerkUserId: string) => getGroupUser(clerkUserId, displayName);

  router.get('/', async (_req, res) => {
    const user = await currentUser(res.locals.clerkUserId);
    const groups = await listGroupsForUser(user.id);
    const images = await avatars(groups.map(group => group.createdBy));
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

  router.param('groupId', (_req, res, next, id: string) => {
    if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) {
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

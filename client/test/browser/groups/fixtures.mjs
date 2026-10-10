// Setup shared by group and bill scenarios, through the same HTTP API the app uses.
// Clicks and assertions stay in the scenarios.
import { randomUUID } from 'node:crypto';

// Alice's group, joined by Bob and Carol in that order.
export async function costcoFriends(env, { name = 'Costco friends' } = {}) {
  const { api, base } = env;
  const { group } = await api('/groups', 'alice-token', 'POST', { name, icon: { type: 'unicode', value: '👨‍👩‍👧‍👦' } });
  const invitation = await api(`/groups/${group.id}/invitation`);
  const invitationToken = invitation.path.split('/').at(-1);
  for (const token of ['bob-token', 'carol-token']) await api('/groups/join', token, 'POST', { token: invitationToken });
  const ids = Object.fromEntries((await api(`/groups/${group.id}`)).group.members.map(member => [member.displayName, member.id]));
  return {
    group, ids, invitationToken,
    // The members dialog over the group page.
    groupUrl: `${base}#/groups/${group.id}`,
    billsUrl: `${base}#/group-bills/${group.id}`,
  };
}

// Observe real ready frames without delaying or substituting the API stream.
// Membership journeys wait for this before changing access in another context.
export async function observeGroupReady(page) {
  await page.addInitScript(() => {
    window.membershipReadyGroups = [];
    const original = window.fetch.bind(window);
    window.fetch = async (url, options) => {
      const groupId = String(url).match(/\/groups\/([^/]+)\/events$/)?.[1];
      const response = await original(url, options);
      if (!groupId || !response.ok || !response.body) return response;
      let frames = '';
      const decoder = new TextDecoder();
      const observed = response.body.pipeThrough(new TransformStream({
        transform(chunk, controller) {
          frames += decoder.decode(chunk, { stream: true });
          let end;
          while ((end = frames.indexOf('\n\n')) >= 0) {
            const frame = frames.slice(0, end);
            frames = frames.slice(end + 2);
            if (frame.startsWith('event: ready') && !window.membershipReadyGroups.includes(groupId))
              window.membershipReadyGroups.push(groupId);
          }
          controller.enqueue(chunk);
        },
      }));
      return new Response(observed, { status: response.status, headers: response.headers });
    };
  });
}

// A bill Alice initiates; `shares` are [token, cents] submissions made in order.
export async function aliceBill(env, groupId, title, totalCents, participantIds, shares = []) {
  let { bill } = await env.api(`/groups/${groupId}/bills`, 'alice-token', 'POST', {
    requestId: randomUUID(), title, purchaseDate: '2026-01-01', timeZone: 'America/Toronto', notes: '', totalCents, participantIds,
  });
  for (const [token, amountCents] of shares)
    ({ bill } = await env.api(`/bills/${bill.id}/share`, token, 'POST', { revision: bill.revision, expectedAmountCents: null, amountCents }));
  return bill;
}

// The completed $100.00 bill from the bill-sharing scenario: Alice $40.00, Bob $59.97,
// so Alice's initiator adjustment is +$0.03 and Bob owes her $59.97.
export const weekendGroceries = (env, group, ids) =>
  aliceBill(env, group.id, 'Weekend groceries', 10000, [ids.Alice, ids.Bob], [['alice-token', 4000], ['bob-token', 5997]]);

// The bill page (#158): the viewer's Your share ticket, and the Bill panel
// with its summary and everyone's share.
export const shareTicket = page => page.getByRole('region', { name: 'Your share', exact: true });
export const billSummary = page => page.getByRole('region', { name: 'Bill summary', exact: true });
export const billPanel = page => page.getByRole('complementary', { name: 'Bill', exact: true });
export const billPeople = page => page.getByRole('region', { name: "Everyone's share", exact: true });

/** Existing hash URLs, shared by links and imperative navigation. */
export const routes = {
  home: '',
  account: '#/account',
  group: (id: string) => `#/groups/${id}`,
  groupBills: (id: string, repaymentId?: string) => `#/group-bills/${id}${repaymentId === undefined ? '' : `?repayment=${repaymentId}`}`,
  bill: (id: string) => `#/bills/${id}`,
  newBill: (groupId: string, draftId?: string) => `#/new-bill/${groupId}${draftId === undefined ? '' : `/${draftId}`}`,
};

/** Preserve the accepted hash grammar, including legacy group-bills links. */
export function parseRoute(route: string) {
  return {
    selectedId: route.startsWith('#/groups/') ? route.slice('#/groups/'.length) : null,
    billId: route.startsWith('#/bills/') ? route.slice('#/bills/'.length) : null,
    newBill: route.match(/^#\/new-bill\/([^/]+)(?:\/([^/]+))?$/),
    billGroupId: route.startsWith('#/group-bills/') ? route.slice('#/group-bills/'.length).split('?')[0] : null,
    invitationToken: route.startsWith('#/join/') ? route.slice('#/join/'.length) : null,
    accountPage: route === '#/account',
  };
}

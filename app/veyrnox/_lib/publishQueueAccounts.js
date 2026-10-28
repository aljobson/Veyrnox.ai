export function queueAccountEligible(account) {
  return account?.status === 'active' && account.publishingEnabled !== false;
}

export function splitQueueAccounts(savedIds, accounts) {
  const byId = new Map(accounts.map(account => [account.id, account]));
  const selected = [], excluded = [];
  for (const id of savedIds) {
    const account = byId.get(id) || null;
    if (queueAccountEligible(account)) selected.push(id);
    else excluded.push({ id, account, reason: account ? (account.status === 'active' ? 'publishingOff' : 'disconnected') : null });
  }
  return { selected, excluded };
}

export function queueSaveAccountIds(ids, accounts) {
  return splitQueueAccounts(ids, accounts).selected;
}

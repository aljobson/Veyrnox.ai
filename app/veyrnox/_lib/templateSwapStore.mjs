// Document-memory only. No credentials or image bytes enter web storage.
export function createSwapStore({ revoke = url => URL.revokeObjectURL(url) } = {}) {
  const records = new Map(), listeners = new Set(), controllers = new Map();
  let accountId = null, suspendedOwner = null, epoch = 0, revision = 0;
  const id = (owner, template, key) => JSON.stringify([owner, template, key]);
  const emit = () => { revision++; for (const cb of listeners) cb(); };
  const strip = record => {
    for (const url of record.urls || []) revoke(url);
    const { files, urls, photo, ...metadata } = record;
    return metadata;
  };
  const stop = () => { for (const c of controllers.values()) c.abort(); controllers.clear(); };
  function purge(owner, metadataOnly) {
    for (const [key, a] of records) if (a.accountId === owner) {
      const metadata = strip(a);
      if (metadataOnly) records.set(key, metadata); else records.delete(key);
    }
  }
  function find(key) { return [...records.entries()].find(([, a]) => a.accountId === accountId && a.key === key); }
  return {
    subscribe(cb) { listeners.add(cb); return () => listeners.delete(cb); },
    revision: () => revision,
    owner: () => accountId,
    get(templateId) { return [...records.values()].filter(a => accountId && a.accountId === accountId && a.templateId === templateId); },
    session(next, reason) {
      if (next === accountId && next !== null) return;
      const previous = accountId || suspendedOwner;
      stop(); epoch++;
      // A request may have reached the server before expiry/abort. Preserve uncertainty.
      for (const [key, a] of records) if (a.accountId === previous) {
        if (a.state === 'submitting') records.set(key, { ...a, state: 'unknown', uncertain: true });
        else if (['processing', 'uploading'].includes(a.state)) records.set(key, { ...a, state: a.files ? 'ready' : 'empty' });
      }
      if (!next && reason === 'expired') suspendedOwner = previous;
      else {
        if (previous && previous !== next) purge(previous, Boolean(next));
        suspendedOwner = null;
      }
      accountId = next; emit();
    },
    put(record) {
      if (!accountId || record.accountId !== accountId) return false;
      records.set(id(accountId, record.templateId, record.key), record); emit(); return true;
    },
    ticket(key) { return { accountId, epoch, key }; },
    valid(ticket) { return Boolean(accountId && ticket.accountId === accountId && ticket.epoch === epoch && find(ticket.key)); },
    update(ticket, changes) {
      if (!this.valid(ticket)) return false;
      const [key, a] = find(ticket.key); records.set(key, { ...a, ...changes }); emit(); return true;
    },
    controller(key) {
      if (!find(key)) throw Error('inactive_attempt');
      const controller = new AbortController();
      const token = Symbol(key); controllers.set(token, controller);
      controller.signal.addEventListener('abort', () => controllers.delete(token), { once: true });
      return controller;
    },
    release(controller) { for (const [key, c] of controllers) if (c === controller) controllers.delete(key); },
    dropFiles(key) { const entry = find(key); if (entry) { records.set(entry[0], strip(entry[1])); emit(); } },
    dispose(key) { const entry = find(key); if (entry) { strip(entry[1]); records.delete(entry[0]); emit(); } },
  };
}

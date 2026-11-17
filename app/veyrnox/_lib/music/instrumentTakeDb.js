// Browser-only persistence for instrument takes (IndexedDB). Every call degrades to a no-op when
// IndexedDB is missing or blocked, so the page still works, just without surviving a reload.

const DB_NAME = 'veyrnox-instrument-takes';
const VERSION = 3;
const connections = new Set();
if (typeof window !== 'undefined') window.addEventListener('pagehide', () => {
  for (const db of connections) db.close();
  connections.clear();
});
export const TAKE_STORES = Object.freeze(['takes', 'shelf', 'beatTakes', 'beatTakeState', 'beatTakeChunks']);

function open() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('indexeddb_unavailable')); return; }
    const request = indexedDB.open(DB_NAME, VERSION);
    let expired = false;
    const timeout = setTimeout(() => { expired = true; reject(new Error('indexeddb_blocked')); }, 2000);
    request.onupgradeneeded = () => {
      TAKE_STORES.forEach((name) => { if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name, { keyPath: 'id' }); });
    };
    request.onsuccess = () => {
      clearTimeout(timeout);
      const db = request.result;
      if (expired) { db.close(); return; }
      db.onversionchange = () => { db.close(); connections.delete(db); };
      connections.add(db); resolve(db);
    };
    request.onerror = () => { clearTimeout(timeout); reject(request.error); };
  });
}

async function run(store, mode, action) {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const result = action(tx.objectStore(store));
      // Audio transactions (including the original shelf stores) have no short timeout.
      const timeout = store === 'beatTakeState' ? setTimeout(() => { try { tx.abort(); } catch { /* Already settled. */ } reject(new Error('indexeddb_timeout')); }, 10000) : null;
      tx.oncomplete = () => { clearTimeout(timeout); resolve(result?.result); };
      tx.onerror = () => { clearTimeout(timeout); reject(tx.error); };
      tx.onabort = () => { clearTimeout(timeout); reject(tx.error); };
    });
  } finally {
    db.close(); connections.delete(db);
  }
}

export async function listSavedTakesStrict(store) {
  const rows = await run(store, 'readonly', s => s.getAll());
  return (Array.isArray(rows) ? rows : []).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

export async function listSavedTakes(store) {
  try {
    const rows = await run(store, 'readonly', (s) => s.getAll());
    return (Array.isArray(rows) ? rows : []).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  } catch { return []; }
}

export async function putSavedTake(store, item) {
  try { await run(store, 'readwrite', (s) => s.put(item)); return true; } catch { return false; }
}

export async function deleteSavedTake(store, id) {
  try { await run(store, 'readwrite', (s) => s.delete(id)); return true; } catch { return false; }
}

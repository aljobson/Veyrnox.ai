// Browser-only persistence for instrument takes (IndexedDB). Every call degrades to a no-op when
// IndexedDB is missing or blocked, so the page still works, just without surviving a reload.

const DB_NAME = 'veyrnox-instrument-takes';
const VERSION = 1;
export const TAKE_STORES = Object.freeze(['takes', 'shelf']);

function open() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('indexeddb_unavailable')); return; }
    const request = indexedDB.open(DB_NAME, VERSION);
    request.onupgradeneeded = () => {
      TAKE_STORES.forEach((name) => { if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name, { keyPath: 'id' }); });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run(store, mode, action) {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const result = action(tx.objectStore(store));
      tx.oncomplete = () => resolve(result?.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
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

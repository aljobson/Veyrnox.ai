import { BEAT_LIMITS, validateBeat, migrateBeat, validBeatId } from './beatDocument.mjs';
import { decideCreate, decideUpdate, decideDelete, validRecord } from './beatStoreRules.mjs';

const NAME = 'veyrnox-beat-projects';
const memory = new Map();
let unavailable = false;
let opened = false;
const connections = new Set();
let hidden = false;
function closeConnections() { for (const db of connections) db.close(); connections.clear(); }
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => { hidden = true; closeConnections(); channel?.close(); channel = undefined; });
  window.addEventListener('pageshow', () => { hidden = false; if (listeners.size) getChannel(); });
}
function open() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') unavailable = true;
    if (unavailable) { reject(new Error('unavailable')); return; }
    let request;
    try { request = indexedDB.open(NAME, 1); }
    catch (error) {
      if (!opened && ['SecurityError', 'InvalidStateError'].includes(error.name)) unavailable = true;
      reject(error); return;
    }
    let expired = false;
    const timeout = setTimeout(() => { expired = true; reject(new Error('blocked')); }, 2000);
    request.onupgradeneeded = () => request.result.createObjectStore('projects', { keyPath: 'id' });
    request.onsuccess = () => {
      clearTimeout(timeout);
      if (expired) request.result.close();
      else {
        const db = request.result;
        db.onversionchange = () => { db.close(); connections.delete(db); };
        connections.add(db); opened = true; resolve(db);
      }
    };
    request.onerror = () => { clearTimeout(timeout); reject(request.error); };
  });
}
let channel;
const listeners = new Set();
function getChannel() {
  if (!hidden && !channel && typeof BroadcastChannel !== 'undefined') {
    try {
      channel = new BroadcastChannel(NAME);
      channel.onmessage = ({ data }) => {
        if (validBeatId(data?.id)) for (const listener of listeners) listener(data);
      };
    } catch { /* Conditional writes still protect browsers without broadcasts. */ }
  }
  return channel;
}
function broadcast(message) {
  if (unavailable) return;
  try { getChannel()?.postMessage(message); } catch { /* Optional notification. */ }
  if (!listeners.size) { channel?.close(); channel = undefined; }
}
export function subscribeBeats(listener) {
  listeners.add(listener);
  getChannel();
  return () => {
    listeners.delete(listener);
    if (!listeners.size) { channel?.close(); channel = undefined; }
  };
}
// Read/check/write all occur in this one transaction, including the device limit.
async function run(mode, decide) {
  let db;
  try {
    db = await open();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('projects', mode);
      const store = tx.objectStore('projects');
      const read = store.getAll();
      let result;
      read.onsuccess = () => {
        try {
          result = decide(read.result);
          if (result.action === 'put') store.put(result.record);
          if (result.action === 'delete') store.delete(result.id);
        } catch (error) { tx.abort(); reject(error); }
      };
      tx.oncomplete = () => {
        memory.clear();
        for (const row of read.result) memory.set(row.id, row);
        if (result.action === 'put') memory.set(result.record.id, result.record);
        if (result.action === 'delete') memory.delete(result.id);
        resolve({ ...result, persistent: true });
      };
      tx.onabort = () => reject(tx.error || new Error('aborted'));
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    if (!unavailable) return { error: 'storage' };
    const result = decide([...memory.values()]);
    if (result.action === 'put') memory.set(result.record.id, structuredClone(result.record));
    if (result.action === 'delete') memory.delete(result.id);
    return { ...result, persistent: false };
  } finally { db?.close(); connections.delete(db); }
}
function writeResult(result) {
  if (result.action === 'put') {
    broadcast({ id: result.record.id, revision: result.record.revision });
    return { ...result, revision: result.record.revision };
  }
  if (result.action === 'delete') broadcast({ id: result.id, deleted: true });
  return result;
}
export async function createBeat(doc) {
  if (!validateBeat(doc).ok) return { error: 'invalid' };
  return writeResult(await run('readwrite', (rows) => {
    const decision = decideCreate(rows.find((r) => r.id === doc.id));
    if (decision.error) return decision;
    if (rows.length >= BEAT_LIMITS.projects) return { error: 'limit' };
    return { action: 'put', record: { id: doc.id, revision: 1, doc, updatedAt: doc.updatedAt } };
  }));
}
export async function updateBeat(doc, expectedRevision) {
  return writeResult(await run('readwrite', (rows) => decideUpdate(rows.find((r) => r.id === doc?.id), doc, expectedRevision)));
}
export async function deleteBeat(id, expectedRevision) {
  return writeResult(await run('readwrite', (rows) => ({ ...decideDelete(rows.find((r) => r.id === id), expectedRevision), id })));
}
export async function listBeats() {
  return run('readonly', (rows) => ({ records: rows.filter(validRecord).map((r) => ({ ...r, doc: migrateBeat(r.doc) })).sort((a, b) => b.updatedAt - a.updatedAt), count: rows.length }));
}
export async function getBeat(id) {
  if (!validBeatId(id)) return { error: 'not_found' };
  return run('readonly', (rows) => {
    const record = rows.find((r) => r.id === id);
    return !record ? { error: 'not_found' } : !validRecord(record) ? { error: 'damaged' } : { record: { ...record, doc: migrateBeat(record.doc) } };
  });
}

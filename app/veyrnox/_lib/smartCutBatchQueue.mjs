export const SMART_CUT_BATCH_VERSION = 1;
export const SMART_CUT_BATCH_MAX = 10;
const STATES = new Set(['pending', 'active', 'completed', 'failed', 'cancelled']);

const clean = (value, max = 120) => String(value ?? '').trim().slice(0, max);
const uniqueProjects = (projects) => {
  const seen = new Set();
  return (Array.isArray(projects) ? projects : []).flatMap((project) => {
    const projectId = clean(project?.id, 80);
    if (!projectId || seen.has(projectId)) return [];
    seen.add(projectId);
    return [{ projectId, name: clean(project?.name), state: 'pending', error: '' }];
  }).slice(0, SMART_CUT_BATCH_MAX);
};

export function createSmartCutBatch({ owner, workspaceId, projects, id, now = Date.now() }) {
  const items = uniqueProjects(projects);
  if (!clean(owner, 80) || !clean(workspaceId, 80) || !clean(id, 80) || items.length < 2) return null;
  return { version: SMART_CUT_BATCH_VERSION, id: clean(id, 80), owner: clean(owner, 80), workspaceId: clean(workspaceId, 80), createdAt: now, updatedAt: now, items };
}

export function parseSmartCutBatch(value, owner, workspaceId) {
  if (!value || value.version !== SMART_CUT_BATCH_VERSION || value.owner !== owner || value.workspaceId !== workspaceId || !Number.isFinite(value.createdAt) || !Number.isFinite(value.updatedAt)) return null;
  const seen = new Set();
  const items = (Array.isArray(value.items) ? value.items : []).flatMap((raw) => {
    const projectId = clean(raw?.projectId, 80);
    if (!projectId || seen.has(projectId)) return [];
    seen.add(projectId);
    return [{ projectId, name: clean(raw?.name), state: STATES.has(raw?.state) ? raw.state : 'pending', error: clean(raw?.error, 240) }];
  }).slice(0, SMART_CUT_BATCH_MAX);
  if (!clean(value.id, 80) || items.length < 2) return null;
  // A recovered queue may have at most one active item. Extra active rows safely resume as pending.
  let active = false;
  return { ...value, items: items.map((item) => {
    if (item.state !== 'active') return item;
    if (active) return { ...item, state: 'pending' };
    active = true;
    return item;
  }) };
}

const change = (queue, projectId, update, now = Date.now()) => ({ ...queue, updatedAt: now, items: queue.items.map((item) => item.projectId === projectId ? update(item) : item) });

export function openSmartCutBatchItem(queue, projectId, now) {
  if (!queue || queue.items.some((item) => item.state === 'active' && item.projectId !== projectId)) return queue;
  return change(queue, projectId, (item) => ['pending', 'failed'].includes(item.state) ? { ...item, state: 'active', error: '' } : item, now);
}
export const finishSmartCutBatchItem = (queue, projectId, now) => change(queue, projectId, (item) => item.state === 'active' ? { ...item, state: 'completed', error: '' } : item, now);
export const failSmartCutBatchItem = (queue, projectId, error = '', now) => change(queue, projectId, (item) => item.state === 'active' ? { ...item, state: 'failed', error: clean(error, 240) } : item, now);
export const retrySmartCutBatchItem = (queue, projectId, now) => change(queue, projectId, (item) => item.state === 'failed' ? { ...item, state: 'pending', error: '' } : item, now);
export const cancelSmartCutBatchItem = (queue, projectId, now) => change(queue, projectId, (item) => ['pending', 'failed'].includes(item.state) ? { ...item, state: 'cancelled', error: '' } : item, now);
export const nextSmartCutBatchItem = (queue) => queue?.items.find((item) => item.state === 'active') || queue?.items.find((item) => item.state === 'pending') || null;
export const smartCutBatchDone = (queue) => !!queue?.items.length && queue.items.every((item) => ['completed', 'cancelled'].includes(item.state));

export const smartCutBatchStorageKey = (owner, workspaceId) => `veyrnox:smart-cut-batch:v1:${clean(owner, 80)}:${clean(workspaceId, 80)}`;
export function readSmartCutBatch(storage, owner, workspaceId) {
  try { return parseSmartCutBatch(JSON.parse(storage?.getItem(smartCutBatchStorageKey(owner, workspaceId)) || 'null'), owner, workspaceId); }
  catch { return null; }
}
export function writeSmartCutBatch(storage, queue) {
  if (typeof storage?.setItem !== 'function') return false;
  try { storage.setItem(smartCutBatchStorageKey(queue.owner, queue.workspaceId), JSON.stringify(queue)); return true; }
  catch { return false; }
}
export function removeSmartCutBatch(storage, owner, workspaceId) {
  if (typeof storage?.removeItem !== 'function') return false;
  try { storage.removeItem(smartCutBatchStorageKey(owner, workspaceId)); return true; }
  catch { return false; }
}

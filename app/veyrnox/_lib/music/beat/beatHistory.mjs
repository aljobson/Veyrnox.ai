export const createHistory = (doc) => ({ present: doc, past: [], future: [], nextId: 1, lastKey: '', lastTime: -Infinity });
export const canUndo = (history) => history.past.length > 0;
export const canRedo = (history) => history.future.length > 0;
export function record(history, nextDoc, { key = '', now = Date.now(), label = 'edit beat' } = {}) {
  if (nextDoc === history.present) return history;
  const coalesce = key && key === history.lastKey && now >= history.lastTime && now - history.lastTime <= 1000 && canUndo(history);
  const entry = { id: history.nextId, doc: history.present, label };
  return { present: nextDoc, past: coalesce ? history.past : [...history.past, entry].slice(-200),
    future: [], nextId: history.nextId + (coalesce ? 0 : 1), lastKey: key, lastTime: now };
}
export const replacePresent = (history, nextDoc) => ({ ...history, present: nextDoc });
function restore(snapshot, present) {
  return { ...snapshot, currentPattern: present.currentPattern, updatedAt: Math.max(snapshot.updatedAt, present.updatedAt) };
}
export function undo(history) {
  if (!canUndo(history)) return history;
  const entry = history.past.at(-1);
  return { ...history, present: restore(entry.doc, history.present), past: history.past.slice(0, -1),
    future: [...history.future, { ...entry, doc: history.present }], lastKey: '', lastTime: -Infinity };
}
export function redo(history) {
  if (!canRedo(history)) return history;
  const entry = history.future.at(-1);
  return { ...history, present: restore(entry.doc, history.present), future: history.future.slice(0, -1),
    past: [...history.past, { ...entry, doc: history.present }], lastKey: '', lastTime: -Infinity };
}

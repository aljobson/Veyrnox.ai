export const createHistory = now => ({ past: [], now, future: [] });

export function commitHistory(history, next) {
    return next === history.now ? history : { past: [...history.past.slice(-49), history.now], now: next, future: [] };
}
export function undoHistory(history) {
    return history.past.length ? { past: history.past.slice(0, -1), now: history.past.at(-1), future: [history.now, ...history.future] } : history;
}
export function redoHistory(history) {
    return history.future.length ? { past: [...history.past, history.now], now: history.future[0], future: history.future.slice(1) } : history;
}
/** Undo and redo must retain the original bytes, even after a clip is deleted. */
export function retainedMedia(history) {
    return new Set([...history.past, history.now, ...history.future].flatMap(tl => Object.keys(tl.media)));
}

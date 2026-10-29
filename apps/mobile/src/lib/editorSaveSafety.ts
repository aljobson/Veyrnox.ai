import { documentIdentity } from './editorBridge';
import type { EditorDraft } from './editorDrafts';
import type { DocumentHead } from './editorProjects';

export function decideDraft(draft: EditorDraft | null, head: DocumentHead): 'none' | 'recover' | 'conflict' {
    if (!draft || documentIdentity(draft.document) === documentIdentity(head.document)) return 'none';
    return draft.baseRevision === head.revision ? 'recover' : 'conflict';
}
export function retryDelay(attempt: number, retryAfterSeconds?: number): number {
    return (retryAfterSeconds && retryAfterSeconds > 0 ? Math.min(600, retryAfterSeconds) : Math.min(60, 5 * 2 ** attempt)) * 1000;
}
// 401 here is never account_changed (handled first); 401 and 408 may have committed nothing or everything, so retry the same request.
export const ambiguous = (status: number) => status === 0 || status === 401 || status === 408 || status === 429 || status >= 500;
// Definite refusals that pause autosave until the person acts.
export const refused = (status: number) => [400, 403, 404, 409].includes(status);
export type Operation = { token: object; epoch: number; state: 'inflight' | 'ambiguous' };
export type Locks = { live: boolean; epoch: number; imports: number; saving: Operation | null; pending: Operation | null; restore: Operation | null; replacing: Operation | null };
export function canStart(s: Locks) {
    return s.live && s.imports === 0 && !s.saving && !s.pending && !s.restore && !s.replacing;
}
export function owns(s: Locks, op: Operation) {
    return s.live && s.epoch === op.epoch && [s.saving, s.replacing].some(lock => lock?.token === op.token);
}
export function canRetry(s: Locks, op: Operation) {
    return s.live && s.epoch === op.epoch && op.state === 'ambiguous' && s.imports === 0 &&
        [s.saving, s.replacing, s.pending, s.restore].every(lock => !lock || lock === op);
}
// The guard is evaluated when work reaches the front, not when it is enqueued.
// A rejected storage operation must not poison subsequent writes/removals.
export function createDraftQueue<T>({ write, remove }: { write(value: T): Promise<boolean>; remove(): Promise<void> }) {
    let tail: Promise<unknown> = Promise.resolve();
    function enqueue<R>(run: () => Promise<R>, current: () => boolean): Promise<R | undefined> {
        const result = tail.then(() => current() ? run() : undefined);
        tail = result.catch(() => undefined);
        return result;
    }
    return {
        write: (value: T, current: () => boolean) => enqueue(() => write(value), current),
        remove: (current: () => boolean) => enqueue(remove, current),
        flush: () => tail,
    };
}

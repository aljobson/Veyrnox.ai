import type { BeatDoc } from './doc';

type Listener = (id: string, doc: BeatDoc) => void | Promise<void>;

/** Reconciliation can fail independently of a successful document write. */
export function createPersistedListeners() {
    const listeners = new Set<Listener>();
    const failed = new Map<Listener, Map<BeatDoc, string>>();
    let timer: ReturnType<typeof setTimeout> | undefined, generation = 0;
    async function deliver(listener: Listener, id: string, doc: BeatDoc, epoch: number) {
        if (epoch !== generation || !listeners.has(listener)) return;
        try { await listener(id, doc); failed.get(listener)?.delete(doc); }
        catch (error) {
            if (epoch !== generation || !listeners.has(listener)) return;
            // Keep every durable document: a later undo must not hide a take that was saved.
            const rows = failed.get(listener) ?? new Map<BeatDoc, string>();
            rows.set(doc, id); failed.set(listener, rows);
            console.warn('Beat post-save reconciliation failed', error);
            schedule();
        }
    }
    function schedule() {
        if (timer) return;
        timer = setTimeout(() => {
            timer = undefined;
            const batch = [...failed], epoch = generation;
            failed.clear();
            void (async () => {
                for (const [listener, rows] of batch) for (const [doc, id] of rows) await deliver(listener, id, doc, epoch);
            })();
        }, 5000);
    }
    return {
        subscribe(listener: Listener) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener); failed.delete(listener);
                if (!failed.size) { clearTimeout(timer); timer = undefined; }
            };
        },
        async notify(id: string, doc: BeatDoc) {
            const epoch = generation;
            for (const listener of listeners) await deliver(listener, id, doc, epoch);
        },
        reset() { generation++; failed.clear(); clearTimeout(timer); timer = undefined; },
    };
}

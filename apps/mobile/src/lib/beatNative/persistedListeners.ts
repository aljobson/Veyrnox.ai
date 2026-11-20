import type { BeatDoc } from './doc';

type Delivery = { id: string; doc: BeatDoc };
const deliveryKey = (id: string, doc: BeatDoc) => JSON.stringify([id, [...new Set(
    Object.values(doc.assets ?? {}).filter(asset => asset.source === 'take').map(asset => asset.ref),
)].sort()]);

type Listener = (id: string, doc: BeatDoc) => void | Promise<void>;

/** Reconciliation can fail independently of a successful document write. */
export function createPersistedListeners() {
    const listeners = new Set<Listener>();
    const failed = new Map<Listener, Map<string, Delivery>>();
    let timer: ReturnType<typeof setTimeout> | undefined, generation = 0;
    async function deliver(listener: Listener, id: string, doc: BeatDoc, epoch: number) {
        if (epoch !== generation || !listeners.has(listener)) return;
        const key = deliveryKey(id, doc);
        try { await listener(id, doc); failed.get(listener)?.delete(key); }
        catch (error) {
            if (epoch !== generation || !listeners.has(listener)) return;
            // Keep distinct durable take sets across undo, but coalesce ordinary edits to the same set.
            const rows = failed.get(listener) ?? new Map<string, Delivery>();
            rows.set(key, { id, doc }); failed.set(listener, rows);
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
                for (const [listener, rows] of batch) for (const { doc, id } of rows.values()) await deliver(listener, id, doc, epoch);
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

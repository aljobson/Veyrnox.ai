import { createBeat, validateBeat, type BeatDoc } from './doc';
import { beatFile, documentFiles, loadRecords, type BeatFiles } from './persist';
import { validCloudLink, type BeatRecord, type CloudLink } from './rules';

export const newId = (): string => 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16));
export type SaveState = 'saved' | 'saving' | 'error' | 'busy';
export function createBeatStore(files: BeatFiles = documentFiles()) {
    let records = new Map<string, BeatRecord>();
    let docs: readonly BeatDoc[] = [];
    const listeners = new Set<() => void>();
    const dirty = new Set<string>(), barriers = new Set<string>(), deleted = new Set<string>();
    const errors = new Set<string>();
    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    const pending = new Map<string, Promise<void>>();
    let hydration: Promise<void> | undefined;
    let hydrationState: 'loading' | 'ready' | 'error' = 'loading';
    let epoch = 0;
    const emit = () => { docs = [...records.values()].map(r => r.doc); listeners.forEach(l => l()); };
    const cancel = (id: string) => { clearTimeout(timers.get(id)); timers.delete(id); };
    const queue = (id: string, action: () => Promise<void>) => {
        const task = (pending.get(id) ?? Promise.resolve()).catch(() => undefined).then(action);
        pending.set(id, task);
        void task.finally(() => { if (pending.get(id) === task) pending.delete(id); }).catch(() => undefined);
        return task;
    };
    async function flushBeat(id: string) {
        cancel(id);
        if (barriers.has(id)) return;
        const generation = epoch;
        return queue(id, async () => {
            if (generation !== epoch || !dirty.has(id) || barriers.has(id)) return;
            const captured = records.get(id);
            try {
                if (captured) await files.write(beatFile(id), JSON.stringify(captured));
                else await files.remove(beatFile(id));
                if (generation !== epoch) return;
                if (records.get(id) === captured) dirty.delete(id);
                errors.delete(id);
            } catch (error) { if (generation === epoch) errors.add(id); throw error; }
            finally { if (generation === epoch) emit(); }
        });
    }
    const schedule = (id: string) => {
        dirty.add(id); errors.delete(id); cancel(id);
        timers.set(id, setTimeout(() => { void flushBeat(id).catch(() => undefined); }, 800));
        emit();
    };
    const api = {
        listBeats: () => docs,
        getBeat: (id: string) => records.get(id)?.doc,
        getRecord: (id: string) => records.get(id),
        subscribeBeats(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
        saveState: (id: string): SaveState => barriers.has(id) ? 'busy' : errors.has(id) ? 'error' : dirty.has(id) ? 'saving' : 'saved',
        hydrationState: () => hydrationState,
        hydrateBeats(): Promise<void> {
            if (hydration) return hydration;
            const generation = epoch;
            hydrationState = 'loading';
            hydration = loadRecords(files).then(saved => {
                if (generation !== epoch) return;
                for (const record of saved) if (!records.has(record.id) && !deleted.has(record.id)) records.set(record.id, record);
                hydrationState = 'ready'; emit();
            }).catch(error => { if (generation === epoch) { hydrationState = 'error'; hydration = undefined; emit(); } throw error; });
            return hydration;
        },
        newBeat(title: string): BeatDoc {
            const doc = createBeat({ id: newId(), title });
            records = new Map([[doc.id, { id: doc.id, doc, revision: 1, updatedAt: doc.updatedAt }], ...records]);
            schedule(doc.id); return doc;
        },
        putBeat(doc: BeatDoc): boolean {
            const previous = records.get(doc.id);
            if (!previous || barriers.has(doc.id) || !validateBeat(doc).ok) return false;
            if (doc === previous.doc) return true;
            const next = { ...doc, updatedAt: Math.max(previous.doc.updatedAt + 1, doc.updatedAt, Date.now()) };
            records.set(doc.id, { ...previous, doc: next, revision: previous.revision + 1, updatedAt: next.updatedAt });
            schedule(doc.id); return true;
        },
        setCloudLink(id: string, cloud: CloudLink): boolean {
            const previous = records.get(id);
            if (!previous || barriers.has(id) || !validCloudLink(cloud)) return false;
            records.set(id, { ...previous, cloud }); schedule(id); return true;
        },
        dropBeat(id: string): void {
            if (barriers.has(id)) return;
            records.delete(id); deleted.add(id); dirty.add(id); cancel(id); emit();
            void flushBeat(id).catch(() => undefined);
        },
        flushBeat,
        async flushBeats() { await Promise.all([...dirty].map(flushBeat)); },
        async replaceFromCloud(id: string, theirs: { doc: BeatDoc; cloud: CloudLink }, options: { stash(doc: BeatDoc): Promise<unknown>; isCurrent(): boolean }) {
            if (barriers.has(id) || !validateBeat(theirs.doc).ok || theirs.doc.id !== id || !validCloudLink(theirs.cloud)) throw new Error('invalid_replacement');
            barriers.add(id); cancel(id); emit();
            try {
                await pending.get(id);
                const captured = records.get(id);
                if (!captured || !options.isCurrent()) throw new Error('account_changed');
                await options.stash(captured.doc);
                if (!options.isCurrent() || records.get(id)?.revision !== captured.revision) throw new Error('local_conflict');
                const replacement = { ...captured, doc: theirs.doc, cloud: theirs.cloud, revision: captured.revision + 1, updatedAt: theirs.doc.updatedAt };
                await files.write(beatFile(id), JSON.stringify(replacement));
                records.set(id, replacement); dirty.delete(id); errors.delete(id);
            } finally {
                barriers.delete(id);
                if (dirty.has(id)) schedule(id); else emit();
            }
        },
        resetBeats() {
            epoch++; timers.forEach(clearTimeout); timers.clear(); records.clear(); dirty.clear(); deleted.clear(); errors.clear();
            hydration = undefined; hydrationState = 'loading'; emit();
        },
    };
    return api;
}
export type BeatStore = ReturnType<typeof createBeatStore>;
export const beatStore = createBeatStore();
export const { listBeats, getBeat, newBeat, putBeat, dropBeat, subscribeBeats, resetBeats, hydrateBeats } = beatStore;

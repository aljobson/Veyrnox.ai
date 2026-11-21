import { createBeat, validateBeat, type BeatDoc } from './doc';
import { beatFile, loadRecords, type AccountBeatFiles, type BeatFiles } from './persist';
import { getCacheUser, subscribeCacheUser } from '../appCache';
import { migratedBeatFiles } from './legacyMigration';
import { validCloudLink, type BeatRecord, type CloudLink } from './rules';
import { createPersistedListeners } from './persistedListeners';

export const newId = (): string => 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16));
export type SaveState = 'saved' | 'saving' | 'error' | 'busy';
const isAccountFiles = (source: BeatFiles | AccountBeatFiles): source is AccountBeatFiles => 'forOwner' in source;
/** With account files, only the signed-in owner's records are loaded, shown or written. */
export function createBeatStore(source: BeatFiles | AccountBeatFiles = migratedBeatFiles) {
    const accounts = isAccountFiles(source) ? source : null;
    let files: BeatFiles | null = isAccountFiles(source) ? null : source;
    let owner: string | null = null, hydrationWanted = false;
    const outgoing = new Set<Promise<unknown>>();
    const parked = new Map<string, Map<string, BeatRecord>>();
    const persistedDocs = new Map<string, BeatDoc>();
    let records = new Map<string, BeatRecord>();
    let docs: readonly BeatDoc[] = [];
    const persisted = createPersistedListeners();
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
            const captured = records.get(id), target = files;
            if (!target) return;
            try {
                if (captured) { await target.write(beatFile(id), JSON.stringify(captured)); }
                else await target.remove(beatFile(id));
                if (generation !== epoch) return;
                if (records.get(id) === captured) dirty.delete(id);
                errors.delete(id);
                if (captured) persistedDocs.set(id, captured.doc);
            } catch (error) { if (generation === epoch) errors.add(id); throw error; }
            finally { if (generation === epoch) emit(); }
            if (captured && generation === epoch) await persisted.notify(id, captured.doc);
        });
    }
    const schedule = (id: string) => {
        dirty.add(id); errors.delete(id); cancel(id);
        timers.set(id, setTimeout(() => { void flushBeat(id).catch(() => undefined); }, 800));
        emit();
    };
    const clearSession = () => {
        epoch++; persisted.reset(); timers.forEach(clearTimeout); timers.clear(); records.clear(); persistedDocs.clear();
        dirty.clear(); barriers.clear(); deleted.clear(); errors.clear(); hydration = undefined; hydrationState = 'loading';
    };
    // Unsaved edits belong to the outgoing account: finish them in its folder. A failed write is retried when it returns.
    const saveOutgoing = () => {
        if (!files || !owner) return;
        const target = files, from = owner;
        for (const id of dirty) {
            const record = records.get(id);
            const task = queue(id, () => record ? target.write(beatFile(id), JSON.stringify(record)) : target.remove(beatFile(id)));
            const tracked = task.catch(() => {
                if (!record) return;
                parked.set(from, new Map(parked.get(from) ?? []).set(id, record));
            }).finally(() => { outgoing.delete(tracked); });
            outgoing.add(tracked);
        }
    };
    const restoreParked = () => {
        const saved = owner ? parked.get(owner) : undefined;
        if (!saved || !owner) return;
        parked.delete(owner);
        for (const [id, record] of saved) { records.set(id, record); schedule(id); }
    };
    const api = {
        onPersisted: persisted.subscribe,
        listBeats: () => docs,
        getPersistedBeat: (id: string) => persistedDocs.get(id),
        getBeat: (id: string) => records.get(id)?.doc,
        getRecord: (id: string) => records.get(id),
        /** The document as it is on disk for the signed-in account, for callers that must prove a save landed. */
        async readSavedDoc(id: string): Promise<BeatDoc | undefined> {
            if (!files) return undefined;
            const raw = await files.read(beatFile(id));
            if (!raw) return undefined;
            const record = JSON.parse(raw) as BeatRecord;
            return !accounts || record.owner === owner ? record.doc : undefined;
        },
        subscribeBeats(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
        saveState: (id: string): SaveState => barriers.has(id) ? 'busy' : errors.has(id) ? 'error' : dirty.has(id) ? 'saving' : 'saved',
        hydrationState: () => hydrationState,
        hydrateBeats(): Promise<void> {
            if (hydration) return hydration;
            hydrationWanted = true;
            if (!files) return Promise.resolve();
            const generation = epoch, reader = owner;
            hydrationState = 'loading';
            hydration = loadRecords(files).then(saved => {
                if (generation !== epoch) return;
                for (const record of saved) if ((!accounts || record.owner === reader) && !deleted.has(record.id)) { persistedDocs.set(record.id, record.doc); if (!records.has(record.id)) records.set(record.id, record); }
                hydrationState = 'ready'; restoreParked(); emit();
            }).catch(error => { if (generation === epoch) { hydrationState = 'error'; hydration = undefined; emit(); } throw error; });
            return hydration;
        },
        newBeat(title: string): BeatDoc {
            if (accounts && !owner) throw new Error('account_required');
            const doc = createBeat({ id: newId(), title });
            records = new Map([[doc.id, { id: doc.id, ...(owner ? { owner } : {}), doc, revision: 1, updatedAt: doc.updatedAt }], ...records]);
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
            records.delete(id); persistedDocs.delete(id); deleted.add(id); dirty.add(id); cancel(id); emit();
            void flushBeat(id).catch(() => undefined);
        },
        flushBeat,
        async flushBeats() { await Promise.all([...dirty].map(flushBeat)); },
        async replaceFromCloud(id: string, theirs: { doc: BeatDoc; cloud: CloudLink }, options: { stash(doc: BeatDoc): Promise<unknown>; isCurrent(): boolean }) {
            if (barriers.has(id) || !validateBeat(theirs.doc).ok || theirs.doc.id !== id || !validCloudLink(theirs.cloud)) throw new Error('invalid_replacement');
            const generation = epoch, target = files;
            if (!target) throw new Error('account_changed');
            barriers.add(id); cancel(id); emit();
            let saved: BeatDoc | undefined;
            try {
                await pending.get(id);
                const captured = records.get(id);
                if (generation !== epoch || !captured || !options.isCurrent()) throw new Error('account_changed');
                await options.stash(captured.doc);
                if (generation !== epoch) throw new Error('account_changed');
                if (!options.isCurrent() || records.get(id)?.revision !== captured.revision) throw new Error('local_conflict');
                const replacement = { ...captured, doc: theirs.doc, cloud: theirs.cloud, revision: captured.revision + 1, updatedAt: theirs.doc.updatedAt };
                await target.write(beatFile(id), JSON.stringify(replacement));
                if (generation !== epoch) throw new Error('account_changed');
                records.set(id, replacement); dirty.delete(id); errors.delete(id);
                persistedDocs.set(id, replacement.doc); saved = replacement.doc;
            } finally {
                if (generation === epoch) { barriers.delete(id); if (dirty.has(id)) schedule(id); else emit(); }
            }
            if (saved) await persisted.notify(id, saved);
        },
        resetBeats() { clearSession(); emit(); },
        setOwner(next: string | null) {
            if (!accounts || next === owner) return;
            saveOutgoing(); clearSession();
            owner = next; files = next ? accounts.forOwner(next) : null;
            emit();
            if (next && hydrationWanted) void api.hydrateBeats().catch(() => undefined);
        },
        /** Account deletion only. Unsaved edits are discarded, then the account's folder is removed. */
        async eraseOwner(target: string) {
            if (!accounts) return;
            if (owner === target) { clearSession(); owner = null; files = null; emit(); }
            parked.delete(target);
            await Promise.allSettled([...pending.values(), ...outgoing]);
            parked.delete(target);
            await accounts.erase(target);
        },
    };
    return api;
}
export type BeatStore = ReturnType<typeof createBeatStore>;
export const beatStore = createBeatStore();
beatStore.setOwner(getCacheUser() ?? null);
subscribeCacheUser(user => beatStore.setOwner(user ?? null));
export const { listBeats, getBeat, newBeat, putBeat, dropBeat, subscribeBeats, resetBeats, hydrateBeats } = beatStore;

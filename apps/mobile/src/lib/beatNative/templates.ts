import { setView, validateBeat, type BeatDoc } from './doc';
import type { BeatStore } from './store';
import { createBeatFromTemplate, type TemplateId } from './labs';
export type CreationStore = Pick<BeatStore, 'newBeat' | 'putBeat' | 'flushBeat' | 'dropBeat' | 'getBeat' | 'saveState'>;
/** A route may open the record only after durable storage succeeds. */
export async function createBeatRecord(store: CreationStore, title: string, build: (initial: BeatDoc) => BeatDoc, check = () => {}) {
    check();
    const initial = store.newBeat(title);
    try {
        const doc = build(initial);
        if (doc.id !== initial.id || !validateBeat(doc).ok || !store.putBeat(doc)) throw new Error('save_failed');
        await store.flushBeat(doc.id);
        check();
        if (!store.getBeat(doc.id) || store.saveState(doc.id) !== 'saved') throw new Error('save_failed');
        return doc;
    } catch (error) {
        store.dropBeat(initial.id);
        await store.flushBeat(initial.id).catch(() => undefined);
        throw error;
    }
}
export function createTemplateBeat(store: CreationStore, template: TemplateId, title: string) {
    return createBeatRecord(store, title, initial => setView(
        createBeatFromTemplate({ template, id: initial.id, title, now: initial.createdAt }), 'song'));
}

/** Start a music edit with an empty audio lane, not a drum pattern. */
export function createMusicEdit(store: CreationStore, title: string) {
    return createBeatRecord(store, title, initial => {
        const first = initial.tracks[0]!;
        const { kit: _kit, ...track } = first;
        return setView({
            ...initial,
            tracks: [{ ...track, name: 'Audio 1', kind: 'audio', regions: [] }],
        }, 'song');
    });
}

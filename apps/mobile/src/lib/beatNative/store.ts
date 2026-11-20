// Beats open on the phone this session. In memory only: local save in app storage is slice N2, so a force-quit loses them.
import { createBeat, validateBeat, type BeatDoc } from './doc';

let beats: readonly BeatDoc[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(l => l());
const newId = (): string => 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16));

export const subscribeBeats = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export const listBeats = (): readonly BeatDoc[] => beats;
export const getBeat = (id: string): BeatDoc | undefined => beats.find(b => b.id === id);
export function newBeat(title: string): BeatDoc {
    const doc = createBeat({ id: newId(), title });
    beats = [doc, ...beats];
    emit();
    return doc;
}
/** Replace a beat only with a document the shared validator accepts. */
export function putBeat(doc: BeatDoc): boolean {
    if (!validateBeat(doc).ok || !beats.some(b => b.id === doc.id)) return false;
    beats = beats.map(b => (b.id === doc.id ? doc : b));
    emit();
    return true;
}
export function dropBeat(id: string): void { beats = beats.filter(b => b.id !== id); emit(); }
export function resetBeats(): void { beats = []; emit(); }

export type RecordingFinalizer = () => Promise<void>;
const finalizers = new Map<string, Set<RecordingFinalizer>>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(listener => listener());
export function subscribeReplacements(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
const replacements = new Set<string>();
export const replacementUnderway = (id: string) => replacements.has(id);
export function registerRecordingFinalizer(id: string, finish: RecordingFinalizer) {
    let registered = finalizers.get(id);
    if (!registered) { registered = new Set(); finalizers.set(id, registered); }
    registered.add(finish);
    return () => {
        const current = finalizers.get(id);
        current?.delete(finish);
        if (!current?.size) finalizers.delete(id);
    };
}
/** The caller holds this lease through media preservation, stash and replacement. */
export async function beforeReplace(id: string): Promise<() => void> {
    if (replacements.has(id)) throw new Error('replacement_underway');
    replacements.add(id); emit();
    try {
        const settled = await Promise.allSettled([...(finalizers.get(id) ?? [])].map(finalize => Promise.resolve().then(finalize)));
        const failed = settled.find((result): result is PromiseRejectedResult => result.status === 'rejected');
        if (failed) throw failed.reason;
    } catch (error) { replacements.delete(id); emit(); throw error; }
    return () => { replacements.delete(id); emit(); };
}

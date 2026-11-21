const finalizers = new Map<string, () => Promise<void>>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(listener => listener());
export function subscribeReplacements(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
const replacements = new Set<string>();
export const replacementUnderway = (id: string) => replacements.has(id);
export function registerRecordingFinalizer(id: string, finish: () => Promise<void>) {
    finalizers.set(id, finish);
    return () => { if (finalizers.get(id) === finish) finalizers.delete(id); };
}
/** The caller holds this lease through media preservation, stash and replacement. */
export async function beforeReplace(id: string): Promise<() => void> {
    if (replacements.has(id)) throw new Error('replacement_underway');
    replacements.add(id); emit();
    try { await finalizers.get(id)?.(); }
    catch (error) { replacements.delete(id); emit(); throw error; }
    return () => { replacements.delete(id); emit(); };
}

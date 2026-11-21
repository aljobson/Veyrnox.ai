import { BEAT_TIP_STEPS, beatTipsSeenKey, type TipId } from './labs';
export const PHONE_TIP_TARGETS: ReadonlySet<TipId> = new Set(['grid', 'library', 'play', 'arrangement', 'shortcuts']);
export const phoneTipSteps = (available: ReadonlySet<TipId>) => BEAT_TIP_STEPS.filter(step => available.has(step.id));
export const nextTip = (index: number, available: ReadonlySet<TipId>) => phoneTipSteps(available)[index + 1] ?? null;
export type TipStorage = { getItem(key: string): string | null; setItem(key: string, value: string): void };
// SecureStore disallows colons. Encode every non-alphanumeric character injectively,
// keeping the web key unchanged at the storage port boundary.
export const secureTipKey = (key: string) => key.replace(/[^a-zA-Z0-9.-]/g, c => `_${c.charCodeAt(0).toString(16)}_`);
// eslint-disable-next-line @typescript-eslint/no-require-imports -- native storage is loaded only when a signed-in editor opens
const secureStore = (): typeof import('expo-secure-store') => require('expo-secure-store');
export const deviceTipStorage: TipStorage = {
    getItem: key => secureStore().getItem(secureTipKey(key)),
    setItem: (key, value) => secureStore().setItem(secureTipKey(key), value),
};
export function tipsSeen(storage: TipStorage, userId: string | null): boolean {
    const key = beatTipsSeenKey(userId);
    if (!key) return true;
    try { return storage.getItem(key) === '1'; } catch { return true; }
}
export function markTipsSeen(storage: TipStorage, userId: string | null): void {
    const key = beatTipsSeenKey(userId);
    try { if (key) storage.setItem(key, '1'); } catch { /* Storage refusal must not interrupt editing. */ }
}

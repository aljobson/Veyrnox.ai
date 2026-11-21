import { appCache, getCacheUser } from '../appCache';
import { captureHandoffOwner } from '../accountHandoffStore';
import { POLICIES, type Cache } from '../cache';
import { normalizeDialogueCastMap, type CastAssignment } from './dialogueShared';

export async function loadDialogueCast(cache: Cache = appCache, user = getCacheUser()) {
    const current = captureHandoffOwner();
    if (!user || user !== getCacheUser()) return [];
    const saved = await cache.read(POLICIES.dialogueCast, user).catch(() => null);
    return current() ? normalizeDialogueCastMap(saved?.value) : [];
}
let tail: Promise<void> = Promise.resolve();
function updateDialogueCast(change: (saved: CastAssignment[]) => CastAssignment[], cache: Cache, user: string | undefined) {
    const current = captureHandoffOwner();
    const write = tail.then(async () => {
        if (!user || user !== getCacheUser() || !current()) return;
        // A failed read must not turn a partial update into a whole-map replacement.
        const checked = cache.readChecked ? await cache.readChecked(POLICIES.dialogueCast, user) : null;
        if (checked?.state === 'error') return;
        const value = checked ? (checked.state === 'present' ? checked.value : null) : (await cache.read(POLICIES.dialogueCast, user))?.value;
        if (!current()) return;
        await cache.write(POLICIES.dialogueCast, change(normalizeDialogueCastMap(value)), user);
        // A slow write after the cache wipe must not resurrect personal names.
        if (!current()) await cache.write(POLICIES.dialogueCast, null, user);
    }).catch(() => undefined);
    tail = write;
    return write;
}
// Explicit voice choices only. The queue reads the latest map before merging each edit.
export function saveDialogueCast(value: unknown, cache: Cache = appCache, user = getCacheUser()) {
    const changed = normalizeDialogueCastMap(value);
    const names = new Set(changed.map(item => item.speaker.toLowerCase()));
    return updateDialogueCast(saved => normalizeDialogueCastMap([...changed, ...saved.filter(item => !names.has(item.speaker.toLowerCase()))]), cache, user);
}
export function forgetDialogueCastSpeakers(speakers: readonly string[], cache: Cache = appCache, user = getCacheUser()) {
    const names = new Set(speakers.map(speaker => speaker.trim().toLowerCase()));
    return updateDialogueCast(saved => saved.filter(item => !names.has(item.speaker.toLowerCase())), cache, user);
}

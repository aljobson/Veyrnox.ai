import { appCache, getCacheUser } from './appCache';
import { POLICIES, type Cache } from './cache';
import { parseFilm, type Film } from './filmStudio';

// The active native studio is kept in the app's per-account cache. Sign-out, account deletion and a change of user remove
// it with the rest of the cache. The text is parsed on every read so a damaged project is dropped rather than shown.

export async function loadStudio(cache: Cache = appCache, userId: string | undefined = getCacheUser()): Promise<{ film: Film; savedAt: number } | null> {
    const saved = await cache.read<unknown>(POLICIES.filmStudio, userId).catch(() => null);
    if (!saved || typeof saved.value !== 'string') return null;
    const parsed = parseFilm(saved.value);
    return parsed.ok ? { film: parsed.film, savedAt: saved.meta.savedAt } : null;
}

// Saves only text that parses; returns the studio, or the reason it was refused.
export async function saveStudio(raw: string, cache: Cache = appCache, userId: string | undefined = getCacheUser()): Promise<{ ok: true; film: Film } | { ok: false; error: string }> {
    const parsed = parseFilm(raw);
    if (!parsed.ok) return parsed;
    if (!userId) return { ok: false, error: 'Sign in to keep a studio on this phone.' };
    await cache.write(POLICIES.filmStudio, raw, userId);
    return { ok: true, film: parsed.film };
}

export async function clearStudio(cache: Cache = appCache, userId: string | undefined = getCacheUser()): Promise<void> {
    if (!userId) return;
    await cache.write(POLICIES.filmStudio, null, userId);
}

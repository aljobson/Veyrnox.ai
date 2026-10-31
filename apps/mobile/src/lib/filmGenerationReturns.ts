import { accountHandoffStore, captureHandoffOwner } from './accountHandoffStore';
import { localFilmId } from './filmHandoffIdentity';
import { latestPrompt, promptContext, type Film } from './filmStudio';
import { ApiError, type ApiClient } from './api';
import { mediaApi } from './media';

export interface FilmReturn {
    id: string; filmId: string; shotId: string; version: number; context: string; prompt: string;
    state: 'pending' | 'succeeded' | 'failed'; switched: boolean; createdAt?: number;
}
let activeFilm: { id: string; current: () => boolean } | null = null;
export const filmReturns = accountHandoffStore<FilmReturn>('film-returns', 100);
export function filmReturnParams(film: Film, shotId: string): Record<string, string> {
    const prompt = latestPrompt(film, shotId);
    if (!prompt) return {};
    return { filmId: localFilmId(film), shotId, promptVersion: String(prompt.version), promptContext: prompt.context };
}
export async function rememberFilmJob(jobId: string, params: Readonly<Record<string, string>>, prompt: string) {
    if (!params.filmId || !params.shotId || !Number.isSafeInteger(Number(params.promptVersion)) || Number(params.promptVersion) < 1 || !params.promptContext) return;
    // Atomic insert: a replay cannot overwrite a terminal result or a recorded film switch.
    await filmReturns.update(jobId, existing => existing ?? { id: jobId, filmId: params.filmId, shotId: params.shotId, version: Number(params.promptVersion),
        context: params.promptContext, prompt, state: 'pending', switched: false, createdAt: Date.now() });
}

export function returnMatches(film: Film, item: FilmReturn): boolean {
    const shot = film.shots.find(s => s.id === item.shotId), latest = latestPrompt(film, item.shotId);
    return localFilmId(film) === item.filmId && !item.switched && !!shot && latest?.version === item.version &&
        latest.context === item.context && latest.content === item.prompt && promptContext(film, shot) === item.context;
}
// Separate history: never rewrite a film, its manual verdicts, or a pending autosave on job completion.
export async function settleFilmJob(jobId: string, state: 'succeeded' | 'failed', activeFilmId?: string, current: () => boolean = () => true) {
    await filmReturns.update(jobId, item => {
        if (!item || !current() || item.state !== 'pending') return undefined;
        const opened = activeFilm?.current() ? activeFilm.id : undefined;
        return { ...item, state, switched: item.switched || (!!activeFilmId && activeFilmId !== item.filmId) || (!!opened && opened !== item.filmId) };
    });
}

export const MAX_PENDING_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export async function refreshFilmReturns(api: ApiClient, film: Film, current: () => boolean) {
    const items = (await filmReturns.list()).filter(r => r.filmId === localFilmId(film));
    for (const item of items) {
        if (!current()) return [];
        if (item.state !== 'pending') continue;
        if (item.createdAt === undefined) await filmReturns.update(item.id, row => row && { ...row, createdAt: Date.now() });
        else if (Date.now() - item.createdAt >= MAX_PENDING_AGE_MS) {
            await settleFilmJob(item.id, 'failed', localFilmId(film), current); continue;
        }
        try {
            const job = await mediaApi(api).getJob(item.id);
            if (!current()) return [];
            if (job.state === 'succeeded' || job.state === 'failed') await settleFilmJob(item.id, job.state, localFilmId(film), current);
        } catch (error) {
            if (current() && error instanceof ApiError && (error.status === 404 || error.code === 'not_found' || error.code === 'job_not_found')) {
                await settleFilmJob(item.id, 'failed', localFilmId(film), current);
            }
        }
    }
    return current() ? (await filmReturns.list()).filter(r => r.filmId === localFilmId(film)) : [];
}

export async function markFilmSwitch(activeFilmId: string) {
    const current = captureHandoffOwner();
    activeFilm = { id: activeFilmId, current };
    for (const item of await filmReturns.list()) {
        if (!current()) return;
        if (item.filmId !== activeFilmId) await filmReturns.update(item.id, latest => latest?.state === 'pending' ? { ...latest, switched: true } : undefined);
    }
}

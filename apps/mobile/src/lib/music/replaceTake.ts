import { ApiError, type ApiClient } from '../api';
import { commitReplaceTake } from './client';
import { notifySongChanged } from './songChanges';
import { isMusicOff } from './probe';
import { isSectionUuid } from './validateSectionActions';
import type { MusicCandidateView } from './types';
type State = Readonly<{ phase: 'idle' | 'committing' | 'committed' | 'unknown' | 'conflict' | 'changed' | 'error'; versionId: string | null; label: string | null }>;
export function createReplaceTake(api: ApiClient, songId: string, generationId: string, isLive: () => boolean, fail: (error: unknown) => void) {
    let state: State = { phase: 'idle', versionId: null, label: null };
    const listeners = new Set<() => void>();
    const update = (patch: Partial<State>) => { if (isLive()) { state = { ...state, ...patch }; listeners.forEach(fn => fn()); } };
    const canKeep = (candidate: MusicCandidateView) => isLive() && candidate.state === 'ready' && isSectionUuid(candidate.version_id)
        && isSectionUuid(generationId) && !['committing', 'committed', 'conflict', 'changed', 'error'].includes(state.phase)
        && (state.phase !== 'unknown' || state.versionId === candidate.version_id);
    return { snapshot: () => state, canKeep,
        subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
        async keep(candidate: MusicCandidateView) {
            if (!canKeep(candidate)) return;
            update({ phase: 'committing', versionId: candidate.version_id, label: candidate.label });
            try {
                await commitReplaceTake(api, songId, generationId, candidate.version_id!);
                if (!isLive()) return;
                update({ phase: 'committed' });
                // A listener failure must not turn acknowledged selection into an unknown outcome.
                try { notifySongChanged(); } catch { /* the commit is already acknowledged */ }
            } catch (error) {
                if (!isLive()) return;
                if (isMusicOff(error)) { fail(error); return; }
                const code = error instanceof ApiError ? error.code : 'network';
                update({ phase: code === 'revision_conflict' ? 'changed' : code === 'take_commit_conflict' ? 'conflict'
                    : code === 'not_found' ? 'error' : 'unknown' });
            }
        },
    };
}

import { ApiError, type ApiClient } from '../api';
import { getPublication } from './publicationClient';
import { createPublicationAttempts } from './publicationAttempts';
import { isDefinitivePublicError } from './publicAttempts';
import { probeMusic, type MusicProbe } from './probe';
import type { Publication, PublishInput } from './validatePublication';
export interface PublicationState {
    read: MusicProbe<Publication | null> | null; busy: boolean; pending: PublishInput | null;
    issue: 'policy' | 'handleTaken' | 'retryPublish' | 'checkUnpublish' | 'writeError' | null;
}
export function createPublicationFlow(api: ApiClient, song: string) {
    const attempts = createPublicationAttempts(api, song), listeners = new Set<() => void>();
    let live = true, epoch = 0, lock = false;
    let state: PublicationState = { read: null, busy: false, pending: null, issue: null };
    const emit = (patch: Partial<PublicationState>) => { if (live) { state = { ...state, ...patch }; listeners.forEach(fn => fn()); } };
    async function load() {
        if (!live) return;
        const ticket = ++epoch;
        const read = await probeMusic(() => getPublication(api, song));
        if (!live || ticket !== epoch) return;
        if (read.state === 'on' && read.data?.status === 'published' && state.pending) {
            attempts.reset();
            emit({ read, pending: null, issue: state.issue === 'retryPublish' ? null : state.issue });
        } else emit({ read });
    }
    async function write(input?: PublishInput) {
        if (!live || lock || state.read?.state !== 'on') return;
        if (state.read.data?.status === 'blocked') return;
        if (!input && (state.pending || state.read.data?.status !== 'published')) return;
        lock = true; ++epoch; emit({ busy: true, issue: null });
        try { if (input) await attempts.publish(input); else await attempts.unpublish(); }
        catch (error) {
            if (!live) return;
            const code = error instanceof ApiError ? error.code : '';
            emit({ issue: code === 'publication_not_allowed' ? 'policy' : code === 'handle_taken' ? 'handleTaken'
                : !input ? (isDefinitivePublicError(error) ? 'writeError' : 'checkUnpublish') : attempts.snapshot() ? 'retryPublish' : 'writeError' });
        } finally {
            if (live) {
                emit({ pending: attempts.snapshot()?.input ?? null, read: null });
                // Acknowledgements (and errors) never stand in for a current GET.
                await load();
                emit({ busy: false }); lock = false;
            }
        }
    }
    return { snapshot: () => state, subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
        isLive: () => live, load, publish: (input: PublishInput) => write(input), unpublish: (confirmedSlug: string) => state.read?.state === 'on' && state.read.data?.slug === confirmedSlug ? write() : Promise.resolve(),
        dispose() { live = false; ++epoch; attempts.reset(); listeners.clear(); },
    };
}

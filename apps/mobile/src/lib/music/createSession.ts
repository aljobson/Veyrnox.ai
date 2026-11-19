import { AppState } from 'react-native';
import { subscribeCacheUser } from '../appCache';
import type { ApiClient } from '../api';
import { createMusicCreateFlow } from './createFlow';
import { createGenerationTracker } from './queue';
let session: ReturnType<typeof createMusicCreateFlow> | null = null;
subscribeCacheUser(() => { session?.dispose(); session = null; });
export function getMusicCreateSession(api: ApiClient) {
    if (!session) {
        const flow = createMusicCreateFlow(api, createGenerationTracker({ api, initialAppState: AppState.currentState,
            subscribeAppState(fn) {
                let previous = AppState.currentState;
                const listener = AppState.addEventListener('change', next => {
                    const foregrounded = next === 'active' && previous !== 'active';
                    previous = next;
                    fn(next);
                    if (foregrounded) void flow.refreshEntitlements();
                });
                return () => listener.remove();
            } }));
        session = flow;
    }
    return session;
}

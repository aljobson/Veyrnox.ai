import { AppState } from 'react-native';
import { subscribeCacheUser } from '../appCache';
import type { ApiClient } from '../api';
import { createMusicCreateFlow } from './createFlow';
import { createGenerationTracker } from './queue';
let session: ReturnType<typeof createMusicCreateFlow> | null = null;
subscribeCacheUser(() => { session?.dispose(); session = null; });
export function getMusicCreateSession(api: ApiClient) {
    if (!session) session = createMusicCreateFlow(api, createGenerationTracker({ api, initialAppState: AppState.currentState,
        subscribeAppState(fn) { const listener = AppState.addEventListener('change', fn); return () => listener.remove(); } }));
    return session;
}

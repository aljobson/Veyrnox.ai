import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { getCacheUser, subscribeCacheUser } from './appCache';
import type { CreatorAnswers } from './creatorAnswers';
import { loadVibe } from './creatorProfileStore';
import { subscribeVibe } from './vibeEvents';

export function useVibeAnswers(refreshKey?: unknown): CreatorAnswers | null {
    const owner = useSyncExternalStore(subscribeCacheUser, getCacheUser, getCacheUser);
    const sequence = useRef(0);
    const [loaded, setLoaded] = useState<{ owner: string | undefined; answers: CreatorAnswers | null } | null>(null);
    useEffect(() => {
        const reload = () => {
            const seq = ++sequence.current;
            void loadVibe().then(value => {
                if (seq === sequence.current && owner === getCacheUser()) setLoaded({ owner, answers: value?.answers ?? null });
            }).catch(() => undefined);
        };
        const unsubscribe = subscribeVibe(reload);
        reload();
        return () => { sequence.current++; unsubscribe(); };
    }, [owner, refreshKey]);
    return owner && loaded?.owner === owner ? loaded.answers : null;
}

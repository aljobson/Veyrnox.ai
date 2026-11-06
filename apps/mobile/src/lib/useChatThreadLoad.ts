import { useEffect, useRef, useState } from 'react';
import type { ApiClient } from './api';
import { chatApi } from './chat';

type Thread = Awaited<ReturnType<ReturnType<typeof chatApi>['getThread']>>;
type Listed = Awaited<ReturnType<ReturnType<typeof chatApi>['listModelsWithLimits']>> | null;
export interface ThreadLoadHandlers {
    started(): void;
    opened(thread: Thread): void;
    listed(thread: Thread, models: Listed): void;
    failed(): void;
    stop(): void;
}

// Loads one chat. It runs again when the account changes (`generation`) or the person taps Try again (`retry`),
// so a failed first load, such as an expired session or a 429, does not strand the chat until the app is reopened.
export function useChatThreadLoad(api: ApiClient, id: string, generation: number, handlers: ThreadLoadHandlers) {
    const [attempt, setAttempt] = useState(0);
    const [failed, setFailed] = useState(false);
    const latest = useRef(handlers);
    latest.current = handlers;
    useEffect(() => {
        let live = true;
        setFailed(false);
        latest.current.started();
        chatApi(api).getThread(id).then(async (thread) => {
            if (!live) return;
            latest.current.opened(thread);
            // The price is shown before sending, so the model list is read; if it fails the chat still opens and
            // sending is held back until the price is known.
            const models = await chatApi(api).listModelsWithLimits().catch(() => null);
            if (live) latest.current.listed(thread, models);
        }).catch(() => { if (live) { setFailed(true); latest.current.failed(); } });
        return () => { live = false; latest.current.stop(); };
    }, [api, id, generation, attempt]);
    return { failed, retry: () => setAttempt((n) => n + 1) };
}

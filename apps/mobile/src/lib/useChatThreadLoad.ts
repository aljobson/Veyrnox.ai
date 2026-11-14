import { useEffect, useRef, useState } from 'react';
import type { ApiClient } from './api';
import { chatApi } from './chat';
import { forgetThread } from './chatLocal';

type Thread = Awaited<ReturnType<ReturnType<typeof chatApi>['getThread']>>;
type Listed = Awaited<ReturnType<ReturnType<typeof chatApi>['listModelsWithLimits']>> | null;
export interface ThreadLoadHandlers {
    started(): void;
    opened(thread: Thread): void;
    listed(thread: Thread, models: Listed): void;
    failed(): void;
    stop(): void;
}

// Chats currently open, so a chat left and opened again at once is never removed by the earlier screen's cleanup.
const openNow = new Map<string, number>();

// Loads one chat. It runs again when the account changes (`generation`) or the person taps Try again (`retry`),
// so a failed first load, such as an expired session or a 429, does not strand the chat until the app is reopened.
export function useChatThreadLoad(api: ApiClient, id: string, generation: number, handlers: ThreadLoadHandlers) {
    const [attempt, setAttempt] = useState(0);
    const [failed, setFailed] = useState(false);
    const latest = useRef(handlers);
    latest.current = handlers;
    // A chat opened with no messages and no instructions is only made when the first message is sent: leaving it
    // untouched removes it, so "New chat" rows do not pile up. The server is asked again first, so a chat that got
    // a message in the meantime is never removed.
    const openedEmpty = useRef(false);
    useEffect(() => {
        openedEmpty.current = false;
        openNow.set(id, (openNow.get(id) ?? 0) + 1);
        return () => {
            openNow.set(id, (openNow.get(id) ?? 1) - 1);
            if (!openedEmpty.current) return;
            const threads = chatApi(api);
            void Promise.resolve().then(() => threads.getThread(id)).then(async (r) => {
                if (openNow.get(id)! > 0 || r.messages.length > 0 || r.thread.system_prompt) return;
                await threads.deleteThread(id);
                await forgetThread(id);
            }).catch(() => undefined);
        };
    }, [api, id]);
    useEffect(() => {
        let live = true;
        setFailed(false);
        latest.current.started();
        chatApi(api).getThread(id).then(async (thread) => {
            if (!live) return;
            openedEmpty.current = thread.messages.length === 0 && !thread.thread.system_prompt;
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

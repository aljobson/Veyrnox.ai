import { useEffect, useRef, useState } from 'react';
import { captureHandoffOwner } from '../../lib/accountHandoffStore';
import { subscribeCacheUser } from '../../lib/appCache';
import { submittedRequests } from '../../lib/submittedRequests';
import type { SubmitRequest } from '../../lib/generationSubmit';

// Only a bounded opaque job id is accepted; words and controls never travel in routes.
export const validReopenId = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(value);
export function useStudioReopen(reopen: string | string[] | undefined, restore: (request: SubmitRequest) => boolean, clear: () => void,
    onRestored?: (jobId: string) => void, ready = true) {
    const callbacks = useRef({ restore, clear, onRestored });
    useEffect(() => { callbacks.current = { restore, clear, onRestored }; });
    const [loading, setLoading] = useState(!!reopen), [unavailable, setUnavailable] = useState(false);
    useEffect(() => {
        let live = true;
        const currentOwner = captureHandoffOwner();
        const unsubscribe = subscribeCacheUser(() => { live = false; setLoading(false); setUnavailable(!!reopen); });
        if (ready && reopen !== undefined) {
            // Clear the previous job before starting the asynchronous account-scoped read.
            // eslint-disable-next-line react-hooks/set-state-in-effect
            callbacks.current.clear(); setLoading(true); setUnavailable(false);
            void (async () => {
                let restored = false;
                try {
                    const saved = validReopenId(reopen) ? (await submittedRequests.list()).find(item => item.id === reopen) : undefined;
                    if (!live) return;
                    restored = currentOwner() && !!saved && callbacks.current.restore(saved.request);
                    // Make another means a new take, so this job stops being resumable outside its own batch.
                    if (restored && saved) callbacks.current.onRestored?.(saved.id);
                } catch { /* Invalid data and storage failures open an empty studio. */ }
                if (live) { setUnavailable(!restored); setLoading(false); }
            })();
        }
        return () => { live = false; unsubscribe(); };
    }, [reopen, ready]);
    return { loading, unavailable, dismiss: () => setUnavailable(false) };
}

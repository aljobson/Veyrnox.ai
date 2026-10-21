import { usePreventRemove } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

// The router supplies repeat for every native removal, including the edge swipe.
export function useEditorLeaveGuard(leaveEditor: () => Promise<boolean>, goBack: () => void) {
    const [allowLeave, setAllowLeave] = useState(false);
    const continuation = useRef<(() => void) | null>(null);
    const busy = useRef(false);
    const tearingDown = useRef(false);
    const mounted = useRef(true);
    useEffect(() => () => { mounted.current = false; }, []);
    const run = useCallback(async (repeat: () => void) => {
        if (busy.current || tearingDown.current) return;
        busy.current = true;
        continuation.current = repeat;
        try {
            if (await leaveEditor()) {
                if (mounted.current && !tearingDown.current) setAllowLeave(true);
            } else continuation.current = null;
        } finally { busy.current = false; }
    }, [leaveEditor]);
    const disablePrevention = usePreventRemove(!allowLeave, ({ repeat }) => { void run(repeat); });
    useEffect(() => {
        if (!allowLeave || !continuation.current) return;
        const repeat = continuation.current;
        continuation.current = null;
        repeat();
    }, [allowLeave]);
    const teardown = useCallback((navigate?: () => void) => {
        tearingDown.current = true;
        continuation.current = null;
        setAllowLeave(true);
        disablePrevention();
        navigate?.();
    }, [disablePrevention]);
    return { done: () => { void run(goBack); }, teardown };
}

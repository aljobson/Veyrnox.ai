import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';
export function useReducedMotion() {
    const [reduced, setReduced] = useState(true);
    useEffect(() => {
        let live = true;
        AccessibilityInfo.isReduceMotionEnabled()
            .then((value) => {
                if (live) setReduced(value);
            })
            .catch(() => {});
        const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
        return () => {
            live = false;
            sub.remove();
        };
    }, []);
    return reduced;
}

// Like useReducedMotion, but null until the system has answered, so an entrance can wait for the real preference instead
// of running (or skipping) on the cautious default.
export function useReducedMotionResolved(): boolean | null {
    const [reduced, setReduced] = useState<boolean | null>(null);
    useEffect(() => {
        let live = true;
        AccessibilityInfo.isReduceMotionEnabled()
            .then((value) => { if (live) setReduced(value); })
            .catch(() => { if (live) setReduced(true); });
        const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
        return () => {
            live = false;
            sub.remove();
        };
    }, []);
    return reduced;
}

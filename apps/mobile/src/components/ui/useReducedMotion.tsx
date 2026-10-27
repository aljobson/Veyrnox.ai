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

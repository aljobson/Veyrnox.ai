import { useCallback, useEffect, useRef } from 'react';
import { useFocusEffect } from 'expo-router';
import { getCacheUser, subscribeCacheUser } from './appCache';

const useFocus = useFocusEffect ?? ((effect: () => void | (() => void)) => useEffect(effect, [effect]));

// Capture before the first await. Blur, unmount and even signing back into the same account revoke the capture.
export function useHandoffScope() {
    const epoch = useRef(0), live = useRef(true);
    useEffect(() => {
        const off = subscribeCacheUser(() => { epoch.current++; });
        return () => { live.current = false; epoch.current++; off(); };
    }, []);
    useFocus(useCallback(() => { live.current = true; return () => { live.current = false; epoch.current++; }; }, []));
    return useCallback(() => {
        const version = epoch.current, owner = getCacheUser();
        return () => live.current && version === epoch.current && owner === getCacheUser();
    }, []);
}

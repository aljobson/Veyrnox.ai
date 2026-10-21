import { useCallback, useRef } from 'react';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { HOP_MS, INITIAL_SCROLL, nextScrollState, reactVey, type ScrollState } from './veyMotion';

// The onScroll for a list or scroll view: as it scrolls, the floating Vey hops now and then. Give the view
// scrollEventThrottle={64}; the hop is a few frames, so no finer reading is needed.
export function useVeyScroll() {
    const state = useRef<ScrollState>(INITIAL_SCROLL);
    return useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
        const step = nextScrollState(state.current, event.nativeEvent.contentOffset.y, Date.now());
        state.current = step.state;
        if (step.hop) reactVey('hop', HOP_MS);
    }, []);
}

import { Canvas, Image, Skia, type SkImage } from '@shopify/react-native-skia';
import { NavigationContext } from 'expo-router/react-navigation';
import { useContext, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, useCallback } from 'react';
import { AccessibilityInfo, AppState, PixelRatio, StyleSheet, View } from 'react-native';
import { createWobnimoRenderer, WobnimoEngine, WobnimoQuality, wobnimoTarget } from '../lib/wobnimoNative';
import type { WobnimoId, WobnimoState } from '../lib/veyCharacterChoice';

export function WobnimoView({ character, state, width, onFailure }: {
    character: WobnimoId; state: WobnimoState; width: number; onFailure?: () => void;
}) {
    const navigation = useContext(NavigationContext);
    const subscribeFocus = useCallback((notify: () => void) => {
        if (!navigation) return () => {};
        const focus = navigation.addListener('focus', notify);
        const blur = navigation.addListener('blur', notify);
        return () => { focus(); blur(); };
    }, [navigation]);
    const readFocus = useCallback(() => navigation?.isFocused() ?? true, [navigation]);
    const focused = useSyncExternalStore(subscribeFocus, readFocus, readFocus);
    const [active, setActive] = useState(AppState.currentState === 'active');
    const [reduced, setReduced] = useState(true);
    const [image, setImage] = useState<SkImage | null>(null);
    const snapshots = useRef(new Set<SkImage>());
    const latest = useRef({ state, onFailure });
    useLayoutEffect(() => { latest.current = { state, onFailure }; }, [state, onFailure]);
    const session = useRef<{
        engine: WobnimoEngine; renderer: ReturnType<typeof createWobnimoRenderer>; density: number;
        quality: WobnimoQuality; failed: boolean;
    } | null>(null);

    useEffect(() => {
        let alive = true;
        let preferenceChanged = false;
        // Stay still until the preference is known; a rejected query preserves that choice.
        AccessibilityInfo.isReduceMotionEnabled().then(value => {
            if (alive && !preferenceChanged) setReduced(value);
        }).catch(() => {});
        const motion = AccessibilityInfo.addEventListener('reduceMotionChanged', value => {
            preferenceChanged = true;
            if (alive) setReduced(value);
        });
        const app = AppState.addEventListener('change', value => setActive(value === 'active'));
        return () => { alive = false; motion.remove(); app.remove(); };
    }, []);

    useEffect(() => {
        try {
            const density = PixelRatio.get();
            const { size } = wobnimoTarget(width, density);
            const engine = new WobnimoEngine(character, latest.current.state);
            const renderer = createWobnimoRenderer(Skia, character, size);
            session.current = { engine, renderer, density, quality: new WobnimoQuality(), failed: false };
            return () => { session.current = null; renderer.dispose(); };
        } catch {
            session.current = null;
            latest.current.onFailure?.();
        }
    }, [character, width]);

    useEffect(() => {
        const current = session.current;
        if (!current || current.failed || !active || !focused) return;
        let frame = 0;
        let stopped = false;
        let last: number | null = null;
        let previousFrame: number | null = null;
        const fail = () => {
            current.failed = true;
            latest.current.onFailure?.();
        };
        try { current.engine.configure(state, reduced); } catch { fail(); return; }
        const tick = (now: number) => {
            if (stopped) return;
            try {
                if (previousFrame !== null) current.quality.adapt(Math.max(0, now - previousFrame));
                previousFrame = now;
                if (last === null || now - last >= 1000 / 30 - 0.5) {
                    const dt = last === null ? 1 / 30 : (now - last) / 1000;
                    last = now;
                    const { size } = wobnimoTarget(width, current.density, current.quality.value);
                    current.renderer.resize(size);
                    const snapshot = current.renderer.draw(current.engine.frame(size, dt));
                    snapshots.current.add(snapshot);
                    setImage(snapshot);
                }
                if (!current.engine.settled) frame = requestAnimationFrame(tick);
            } catch { fail(); }
        };
        frame = requestAnimationFrame(tick);
        return () => { stopped = true; cancelAnimationFrame(frame); };
    }, [character, width, state, reduced, active, focused]);

    // Release replaced snapshots after React has committed the new image, and on unmount.
    useEffect(() => {
        for (const old of snapshots.current) if (old !== image) {
            old.dispose(); snapshots.current.delete(old);
        }
    }, [image]);
    useEffect(() => {
        const owned = snapshots.current;
        return () => { owned.forEach(snapshot => snapshot.dispose()); owned.clear(); };
    }, []);
    return (
        <View style={[styles.box, { width, height: width }]} pointerEvents="none"
            accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <Canvas style={styles.canvas} colorSpace="srgb">
                {image ? <Image image={image} x={0} y={0} width={width} height={width} fit="fill" /> : null}
            </Canvas>
        </View>
    );
}

const styles = StyleSheet.create({
    box: { overflow: 'hidden' },
    canvas: { flex: 1, backgroundColor: 'transparent' },
});

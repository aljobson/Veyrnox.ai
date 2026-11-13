import { Canvas, Skia, useCanvasRef, Picture, Group, useImage, type SkPicture } from '@shopify/react-native-skia';
import { useEffect, useRef, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { renderEffectStack } from '../../lib/liveEdit/renderEffectStack';
import type { Stack } from '../../lib/liveEdit/engine';
import type { LocalSource } from '../../lib/liveEdit/media';
import type { Inference } from '../../lib/liveEdit/protocol';
// `revision` changes when an asynchronously produced 3D wig overlay arrives, so the picture is redrawn with it.
type Props = { source: LocalSource; stack: Stack; inference: Inference | null; label: string; maxHeight: number; revision?: number; onError(): void; onReady(): void };
export function EffectPhoto({ source, stack, inference, label, maxHeight, revision = 0, onError, onReady }: Props) {
    const image = useImage(source.uri, onError), [picture, setPicture] = useState<SkPicture | null>(null);
    const canvas = useCanvasRef();
    const current = useRef<SkPicture | null>(null), retired = useRef<SkPicture[]>([]);
    const [width, setWidth] = useState(0);
    useEffect(() => {
        if (!image) return;
        try {
            const result = renderEffectStack({ ...source, image }, stack, inference);
            if (current.current) retired.current.push(current.current);
            current.current = result; setPicture(result);
        } catch { onError(); }
    }, [image, source, stack, inference, revision, onError, onReady]); // eslint-disable-line react-hooks/exhaustive-deps
    // Canvas commits its children in a layout effect. The tiny async snapshot fences
    // native rendering after that commit; it is never encoded, stored or uploaded.
    useEffect(() => {
        if (!picture || width <= 0) return;
        let cancelled = false;
        const frame = requestAnimationFrame(() => {
            const view = canvas.current;
            if (!view) return;
            void view.makeImageSnapshotAsync(Skia.XYWHRect(0, 0, 1, 1)).then(snapshot => {
                snapshot.dispose();
                if (cancelled || current.current !== picture) return;
                retired.current.splice(0).forEach(old => old.dispose());
                onReady();
            }).catch(() => { if (!cancelled) onError(); });
        });
        return () => { cancelled = true; cancelAnimationFrame(frame); };
    }, [picture, width, canvas, onReady, onError]);
    useEffect(() => () => {
        current.current?.dispose(); current.current = null;
        retired.current.splice(0).forEach(old => old.dispose());
    }, []);
    const scale = Math.min(width / source.width, maxHeight / source.height);
    const height = width > 0 ? source.height * scale : maxHeight;
    return <View accessible accessibilityRole="image" accessibilityLabel={label} onLayout={e => setWidth(e.nativeEvent.layout.width)} style={{ width: '100%', height }}>
        {picture && width > 0 ? <Canvas ref={canvas} pointerEvents="none" style={StyleSheet.absoluteFill}>
            <Group transform={[{ translateX: (width - source.width * scale) / 2 }, { scale }]}><Picture picture={picture} /></Group>
        </Canvas> : null}
    </View>;
}

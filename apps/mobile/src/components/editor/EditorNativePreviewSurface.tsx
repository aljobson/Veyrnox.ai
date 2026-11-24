import type * as SkiaModule from '@shopify/react-native-skia';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { PixelRatio, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { timelineSize } from '../../../../../app/veyrnox/_lib/editorRender.mjs';
import { renderNativeEditorPreviewFrame } from '../../lib/editorNativePreview';
import type { Timeline } from '../../lib/nativeEditorModel';

declare const require: (id: string) => unknown;
type SkiaLibrary = typeof SkiaModule;
type Size = { readonly width: number; readonly height: number };
export type EditorNativePreviewDisplay = { readonly frame: number; readonly exact: true };

let loadedSkia: SkiaLibrary | null | undefined;
function skiaLibrary() {
    if (loadedSkia === undefined) {
        try {
            const candidate = require('@shopify/react-native-skia') as Partial<SkiaLibrary>;
            loadedSkia = candidate.Skia && candidate.Canvas && candidate.Image ? candidate as SkiaLibrary : null;
        } catch { loadedSkia = null; }
    }
    return loadedSkia;
}

function pixelSize(width: number, height: number, reference: Size) {
    if (!(width > 0 && height > 0 && reference.width > 0 && reference.height > 0)) return { width: 0, height: 0 };
    const scale = PixelRatio.get(), factor = Math.min(width * scale / reference.width, height * scale / reference.height,
        1280 / reference.width, 1280 / reference.height, Math.sqrt(1280 * 720 / (reference.width * reference.height)));
    return { width: Math.max(1, Math.floor(reference.width * factor)), height: Math.max(1, Math.floor(reference.height * factor)) };
}

function containedRect(width: number, height: number, reference: Size) {
    const factor = Math.min(width / reference.width, height / reference.height);
    const w = reference.width * factor, h = reference.height * factor;
    return { x: (width - w) / 2, y: (height - h) / 2, width: w, height: h };
}

type RenderJob = {
    ticket: number; account: string; project: string; timeline: Timeline; frame: number;
    width: number; height: number; sources: Readonly<Record<string, string>>; controller: AbortController;
};

/** One native render may be in flight; rapid playback replaces the trailing request, never queues frames. */
export function EditorNativePreviewSurface({ enabled, account, project, timeline, frame, localMediaUris, onDisplayed }: {
    readonly enabled: boolean; readonly account: string; readonly project: string; readonly timeline: Timeline; readonly frame: number;
    readonly localMediaUris: Readonly<Record<string, string>>;
    readonly onDisplayed: (display: EditorNativePreviewDisplay | null) => void;
}) {
    const skia = skiaLibrary(), [size, setSize] = useState({ width: 0, height: 0 });
    const dimensions = pixelSize(size.width, size.height, timelineSize(timeline, 720));
    const [rendered, setRendered] = useState<{ frame: number; image: SkiaModule.SkImage; reference: Size } | null>(null);
    const pending = useRef<RenderJob | null>(null), running = useRef(false), ticket = useRef(0);
    const active = useRef<AbortController | null>(null), mounted = useRef(true), images = useRef(new Set<SkiaModule.SkImage>());

    const pump = useCallback(async () => {
        if (running.current) return;
        running.current = true;
        try {
            while (pending.current && mounted.current) {
                const job = pending.current; pending.current = null; active.current = job.controller;
                const result = await renderNativeEditorPreviewFrame({ ...job, signal: job.controller.signal });
                if (result.ok) {
                    if (!mounted.current || job.ticket !== ticket.current || job.controller.signal.aborted) result.image.dispose();
                    else {
                        images.current.add(result.image);
                        setRendered({ frame: job.frame, image: result.image, reference: result.plan.referenceSize });
                    }
                } else if (mounted.current && job.ticket === ticket.current) setRendered(null);
            }
        } finally { active.current = null; running.current = false; }
    }, []);

    useEffect(() => {
        const nextTicket = ++ticket.current;
        active.current?.abort(); pending.current?.controller.abort(); pending.current = null;
        if (!enabled || !skia || !account || !project || dimensions.width < 1 || dimensions.height < 1) return;
        const controller = new AbortController();
        pending.current = { ticket: nextTicket, account, project, timeline, frame, width: dimensions.width,
            height: dimensions.height, sources: localMediaUris, controller };
        void pump();
        return () => controller.abort();
    }, [account, dimensions.height, dimensions.width, enabled, frame, localMediaUris, project, pump, skia, timeline]);

    const shown = enabled && account && project && dimensions.width > 0 && dimensions.height > 0 && rendered?.frame === frame ? rendered : null;
    useLayoutEffect(() => { onDisplayed(shown ? { frame: shown.frame, exact: true } : null); }, [onDisplayed, shown]);
    useEffect(() => {
        for (const image of images.current) if (image !== shown?.image) { image.dispose(); images.current.delete(image); }
    }, [shown]);
    useEffect(() => () => {
        mounted.current = false; ++ticket.current; active.current?.abort(); pending.current?.controller.abort(); pending.current = null;
        images.current.forEach(image => image.dispose()); images.current.clear();
    }, []);

    const onLayout = (event: LayoutChangeEvent) => {
        const next = event.nativeEvent.layout;
        setSize(current => current.width === next.width && current.height === next.height ? current : { width: next.width, height: next.height });
    };
    const display = containedRect(size.width, size.height, shown?.reference ?? { width: 16, height: 9 });
    return <View testID="editor-native-preview-surface" pointerEvents="none" accessible={false} accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants" style={StyleSheet.absoluteFill} onLayout={onLayout}>
        {shown && skia ? <skia.Canvas testID="editor-native-preview-canvas" pointerEvents="none" style={StyleSheet.absoluteFill}>
            <skia.Image image={shown.image} x={display.x} y={display.y} width={display.width} height={display.height} fit="fill" />
        </skia.Canvas> : null}
    </View>;
}

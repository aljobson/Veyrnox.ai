import type * as SkiaModule from '@shopify/react-native-skia';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { PixelRatio, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import type { ApiClient } from '../../lib/api';
import { editorPreviewPlan, type EditorPreviewPlan } from '../../lib/editorPreviewPlan';
import { createEditorStaticPreviewSourceLoader, editorStaticPreviewSourceKey, type EditorStaticPreviewSourceSet } from '../../lib/editorStaticPreviewSources';
import type { Timeline } from '../../lib/nativeEditorModel';

declare const require: (id: string) => unknown;
type SkiaLibrary = typeof SkiaModule;
type EditorRenderLibrary = typeof import('../../lib/editorRender');
export type EditorStaticPreviewDisplay = { readonly key: string; readonly exact: boolean };

let loadedNative: { skia: SkiaLibrary; renderer: EditorRenderLibrary } | null | undefined;
function nativeLibraries(): { skia: SkiaLibrary; renderer: EditorRenderLibrary } | null {
    if (loadedNative === undefined) {
        try {
            const candidate = require('@shopify/react-native-skia') as Partial<SkiaLibrary>;
            const renderer = require('../../lib/editorRender') as Partial<EditorRenderLibrary>;
            loadedNative = candidate.Skia && candidate.Canvas && candidate.Image && renderer.bindStaticPreviewPlan && renderer.renderStaticPreviewImage
                && renderer.SKIA_STATIC_PREVIEW_CAPABILITIES && renderer.STATIC_PREVIEW_LIMITS
                ? { skia: candidate as SkiaLibrary, renderer: renderer as EditorRenderLibrary } : null;
        } catch { loadedNative = null; }
    }
    return loadedNative;
}

type Size = { readonly width: number; readonly height: number };

function containedRect(width: number, height: number, reference: Size) {
    if (!(width > 0 && height > 0 && reference.width > 0 && reference.height > 0)) return { x: 0, y: 0, width: 0, height: 0 };
    const factor = Math.min(width / reference.width, height / reference.height);
    const containedWidth = reference.width * factor, containedHeight = reference.height * factor;
    return { x: (width - containedWidth) / 2, y: (height - containedHeight) / 2, width: containedWidth, height: containedHeight };
}

function boundedPixelSize(width: number, height: number, scale: number, reference: Size,
    limits: EditorRenderLibrary['STATIC_PREVIEW_LIMITS']) {
    if (!(width > 0 && height > 0 && reference.width > 0 && reference.height > 0)) return { width: 0, height: 0 };
    const factor = Math.min(width * scale / reference.width, height * scale / reference.height,
        limits.maxWidth / reference.width, limits.maxHeight / reference.height,
        Math.sqrt(limits.maxPixels / (reference.width * reference.height)));
    return { width: Math.max(1, Math.floor(reference.width * factor)), height: Math.max(1, Math.floor(reference.height * factor)) };
}

function frameInvariantRenderProjection(plan: EditorPreviewPlan): unknown {
    const frameDependent = plan.visuals.some(({ clip, transition }) => !!transition
        || !!clip.keyframes?.length || !!clip.parameterKeyframes?.length || !!clip.maskKeyframes?.length
        || (!!clip.animation && Object.values(clip.animation).some(value => value !== undefined && value !== 'none')));
    if (frameDependent) return plan;
    return {
        referenceSize: plan.referenceSize,
        background: plan.background,
        visuals: plan.visuals.map(visual => ({
            layerIndex: visual.layerIndex,
            clip: { id: visual.clip.id, mediaId: visual.clip.mediaId, mask: visual.clip.mask, background: visual.clip.background },
            crop: visual.crop, fit: visual.fit, transform: visual.transform, reveal: visual.reveal,
            filter: visual.filter, colour: visual.colour, mask: visual.mask, blend: visual.blend,
        })),
    };
}

export function EditorStaticPreviewSurface({ enabled, timeline, frame, api, localMediaUris, onDisplayed }: {
    readonly enabled: boolean;
    readonly timeline: Timeline;
    readonly frame: number;
    readonly api: Pick<ApiClient, 'request'>;
    readonly localMediaUris: Readonly<Record<string, string>>;
    readonly onDisplayed: (display: EditorStaticPreviewDisplay | null) => void;
}) {
    const native = nativeLibraries(), lib = native?.skia ?? null;
    const [size, setSize] = useState({ width: 0, height: 0 });
    const [loader] = useState(createEditorStaticPreviewSourceLoader);
    const generation = useRef(0);
    const sourceCache = useRef<EditorStaticPreviewSourceSet | null>(null);
    const outputs = useRef(new Set<SkiaModule.SkImage>());
    const [rendered, setRendered] = useState<{
        key: string; sourceKey: string; exact: boolean; image: SkiaModule.SkImage;
        referenceSize: Size;
    } | null>(null);
    const plan = useMemo(() => enabled && native
        ? editorPreviewPlan(timeline, frame, native.renderer.SKIA_STATIC_PREVIEW_CAPABILITIES) : null,
        [enabled, native, timeline, frame]);
    const pixelSize = useMemo(() => native && plan
        ? boundedPixelSize(size.width, size.height, PixelRatio.get(), plan.referenceSize, native.renderer.STATIC_PREVIEW_LIMITS)
        : { width: 0, height: 0 }, [native, plan?.referenceSize.height, plan?.referenceSize.width, size.height, size.width]);
    const visuallySupported = !!plan && plan.visuals.length > 0
        && plan.visuals.every(layer => layer.media?.kind === 'image')
        && plan.capabilities.unsupported.every(use => use.capability === 'audio-mix');
    const sourceKey = useMemo(() => plan ? editorStaticPreviewSourceKey(plan, timeline, localMediaUris) : '', [plan, timeline, localMediaUris]);
    const requestKey = plan && lib && pixelSize.width > 0 && pixelSize.height > 0 && visuallySupported
        ? `${pixelSize.width}x${pixelSize.height}:${sourceKey}:${JSON.stringify(frameInvariantRenderProjection(plan))}` : '';
    const latestRequest = useRef({ plan, timeline, api, localMediaUris });
    latestRequest.current = { plan, timeline, api, localMediaUris };
    // A previous snapshot may bridge a render generation only while its decoded source identity
    // still matches. Cross-source generations immediately reveal the correct legacy preview.
    const shown = requestKey && rendered?.sourceKey === sourceKey ? rendered : null;

    useEffect(() => {
        const { plan, timeline, api, localMediaUris } = latestRequest.current;
        const ticket = ++generation.current;
        loader.cancel();
        if (sourceCache.current && sourceCache.current.key !== sourceKey) {
            sourceCache.current.dispose(); sourceCache.current = null;
        }
        setRendered(current => current?.sourceKey !== sourceKey ? null : current);
        if (!requestKey || !lib || !native || !plan) { setRendered(null); return; }
        let current = true;
        const render = (sources: EditorStaticPreviewSourceSet) => {
            let output: ReturnType<EditorRenderLibrary['renderStaticPreviewImage']> | null = null;
            try {
                output = native.renderer.renderStaticPreviewImage(lib.Skia,
                    native.renderer.bindStaticPreviewPlan(plan, pixelSize.width, pixelSize.height, sources.images));
            } catch { /* The legacy surface remains mounted. */ }
            if (!output?.ok) { setRendered(null); return; }
            if (!current || ticket !== generation.current) { output.image.dispose(); return; }
            outputs.current.add(output.image);
            setRendered({
                key: requestKey, sourceKey, exact: plan.capabilities.exact, image: output.image,
                referenceSize: plan.referenceSize,
            });
        };
        const cached = sourceCache.current;
        if (cached?.key === sourceKey) render(cached);
        else void loader.load({ plan, timeline, api, localMediaUris }).then(result => {
            if (result.status !== 'ready') { if (current && ticket === generation.current) setRendered(null); return; }
            if (!current || ticket !== generation.current) { result.sources.dispose(); return; }
            sourceCache.current = result.sources;
            render(result.sources);
        }).catch(() => { if (current && ticket === generation.current) setRendered(null); });
        return () => { current = false; loader.cancel(); };
    }, [lib, loader, native, pixelSize.height, pixelSize.width, requestKey, sourceKey]);

    // Report only the image React has committed for the current generation.
    useLayoutEffect(() => {
        const exact = shown?.key === requestKey ? plan?.capabilities.exact ?? shown.exact : shown?.exact;
        onDisplayed(shown ? { key: shown.key, exact: exact ?? false } : null);
    }, [onDisplayed, plan?.capabilities.exact, requestKey, shown]);

    // Replaced snapshots are released only after React has committed their removal.
    useEffect(() => {
        for (const image of outputs.current) if (image !== shown?.image) { image.dispose(); outputs.current.delete(image); }
    }, [shown]);
    useEffect(() => {
        const owned = outputs.current;
        return () => {
            generation.current += 1; loader.dispose(); sourceCache.current?.dispose(); sourceCache.current = null;
            owned.forEach(image => image.dispose()); owned.clear();
        };
    }, [loader]);

    const onLayout = (event: LayoutChangeEvent) => {
        const next = event.nativeEvent.layout;
        setSize(current => current.width === next.width && current.height === next.height ? current : { width: next.width, height: next.height });
    };
    const display = containedRect(size.width, size.height, shown?.referenceSize ?? plan?.referenceSize ?? { width: 1, height: 1 });
    return <View testID="editor-static-preview-surface" pointerEvents="none" accessible={false} accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants" style={StyleSheet.absoluteFill} onLayout={onLayout}>
        {shown ? <View testID="editor-static-preview-backdrop" pointerEvents="none"
            style={[StyleSheet.absoluteFill, { backgroundColor: '#000000' }]} /> : null}
        {shown && lib ? <lib.Canvas testID="editor-static-preview-canvas" pointerEvents="none" style={StyleSheet.absoluteFill}>
            <lib.Image image={shown.image} x={display.x} y={display.y} width={display.width} height={display.height} fit="fill" />
        </lib.Canvas> : null}
    </View>;
}

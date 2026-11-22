import type { SkImage } from '@shopify/react-native-skia';
import type { EditorPreviewCapability, EditorPreviewPlan, EditorPreviewVisualPlan } from '../editorPreviewPlan';
import type { StaticPreviewBackground, StaticPreviewLayer, StaticPreviewPlan, StaticPreviewUnsupportedFeature } from './types';

/** Capabilities implemented by this bounded static Skia slice. */
export const SKIA_STATIC_PREVIEW_CAPABILITIES = Object.freeze([
    'timeline-background', 'image-source', 'graphic-source', 'fit', 'crop', 'transform', 'visual-layering', 'blend', 'mask', 'clip-animation',
    'clip-background-solid', 'clip-background-blur', 'clip-background-image',
] as const satisfies readonly EditorPreviewCapability[]);

const supported = new Set<EditorPreviewCapability>(SKIA_STATIC_PREVIEW_CAPABILITIES);
const fullReveal = (visual: EditorPreviewVisualPlan) => visual.reveal.x === 0 && visual.reveal.y === 0
    && visual.reveal.width === 1 && visual.reveal.height === 1;

function unsupportedFeature(capability: EditorPreviewCapability): StaticPreviewUnsupportedFeature | null {
    switch (capability) {
        case 'video-source': return 'video';
        case 'missing-media':
        case 'unknown-media-source': return 'missing-source-image';
        case 'transition': return 'transition';
        case 'animation-reveal': return 'animation-reveal';
        case 'basic-filter': return 'filter';
        case 'smart-picture': return 'smart-picture';
        case 'advanced-colour': return 'colour';
        case 'effect': return 'effect';
        case 'text-layer':
        case 'caption-words':
        case 'custom-font': return 'text';
        // Audio is handled by the playback/export audio pipeline, not a static pixel compositor.
        case 'audio-mix': return null;
        default: return supported.has(capability) ? null : 'missing-source-image';
    }
}

function background(visual: EditorPreviewVisualPlan, images: Readonly<Record<string, SkImage>>): {
    value: StaticPreviewBackground; unsupported: StaticPreviewUnsupportedFeature[];
} {
    const raw = visual.clip.background;
    if (!raw || raw.type === 'none') return { value: { type: 'none' }, unsupported: [] };
    if (raw.type === 'solid') return { value: { type: 'solid', color: raw.color }, unsupported: [] };
    if (raw.type === 'blur') return { value: { type: 'blur', color: raw.color, blur: raw.blur }, unsupported: [] };
    const image = images[raw.mediaId];
    return { value: { type: 'image', color: raw.color, ...(image ? { image } : {}) }, unsupported: image ? [] : ['missing-background-image'] };
}

/**
 * Bind caller-owned static image handles to the one canonical `EditorPreviewPlan`.
 * No frame selection, ordering, transition, animation, colour or mask evaluation is repeated here.
 */
export function bindStaticPreviewPlan(preview: EditorPreviewPlan, width: number, height: number,
    images: Readonly<Record<string, SkImage>>): StaticPreviewPlan {
    const visualIds = new Set(preview.visuals.map(visual => visual.clip.id));
    const globalUnsupported = preview.capabilities.requirements
        // Keep requirements for canonical-orphan clips visible even though there is no drawable layer.
        .filter(requirement => requirement.scope !== 'visual' || !requirement.itemId || !visualIds.has(requirement.itemId))
        .map(requirement => unsupportedFeature(requirement.capability))
        .filter((value): value is StaticPreviewUnsupportedFeature => value !== null);
    const layers: StaticPreviewLayer[] = preview.visuals.map(visual => {
        const id = visual.clip.id, mediaId = visual.clip.mediaId || '';
        const image = images[mediaId], backdrop = background(visual, images);
        const features = preview.capabilities.requirements
            .filter(requirement => requirement.scope === 'visual' && requirement.itemId === id)
            .map(requirement => unsupportedFeature(requirement.capability))
            .filter((value): value is StaticPreviewUnsupportedFeature => value !== null);
        if (!fullReveal(visual)) features.push('animation-reveal');
        if (!image) features.push(visual.media?.kind === 'video' ? 'video' : 'missing-source-image');
        features.push(...backdrop.unsupported);
        const mask = visual.mask && visual.clip.mask && visual.clip.mask !== 'none'
            ? { shape: visual.clip.mask as NonNullable<StaticPreviewLayer['mask']>['shape'], ...visual.mask }
            : undefined;
        return {
            id,
            // The canonical plan is already sorted by web track order; retain it exactly.
            trackOrder: 0,
            clipOrder: visual.layerIndex,
            ...(image ? { image } : {}),
            crop: visual.crop,
            fit: visual.fit,
            transform: visual.transform,
            blend: visual.blend as StaticPreviewLayer['blend'],
            ...(mask ? { mask } : {}),
            background: backdrop.value,
            ...(features.length ? { unsupported: [...new Set(features)] } : {}),
        };
    });
    return {
        width, height, background: preview.background, layers,
        ...(globalUnsupported.length ? { unsupported: [...new Set(globalUnsupported)] } : {}),
    };
}

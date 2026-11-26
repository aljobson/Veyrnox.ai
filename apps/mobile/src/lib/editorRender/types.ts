import type { SkImage } from '@shopify/react-native-skia';

export const STATIC_PREVIEW_LIMITS = Object.freeze({
    maxWidth: 1280,
    maxHeight: 1280,
    maxPixels: 1280 * 720,
    maxLayers: 40,
    maxFilterOutset: 180,
    maxLayerPixels: 1_800_000,
});

export const STATIC_PREVIEW_BLENDS = [
    'source-over', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'difference',
] as const;

export type StaticPreviewBlend = (typeof STATIC_PREVIEW_BLENDS)[number];
export type StaticPreviewMaskShape = 'circle' | 'rounded' | 'horizontal' | 'vertical';
export type StaticPreviewUnsupportedFeature =
    | 'animation-reveal'
    | 'behind-subject'
    | 'colour'
    | 'effect'
    | 'filter'
    | 'missing-background-image'
    | 'missing-source-image'
    | 'smart-picture'
    | 'text'
    | 'transition'
    | 'video';

export interface StaticPreviewTransform {
    readonly x: number;
    readonly y: number;
    readonly scale: number;
    readonly rotation: number;
    readonly opacity: number;
    readonly flipX: boolean;
    readonly flipY: boolean;
}

export interface StaticPreviewMask {
    readonly shape: StaticPreviewMaskShape;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly rotation: number;
    readonly feather: number;
    readonly inverted: boolean;
}

export interface StaticPreviewFilter {
    readonly brightness: number;
    readonly contrast: number;
    readonly saturate: number;
    readonly hue: number;
    readonly blur: number;
}

export type StaticPreviewBackground =
    | { readonly type: 'none' }
    | { readonly type: 'solid'; readonly color: string }
    | { readonly type: 'blur'; readonly color: string; readonly blur: number }
    | { readonly type: 'image'; readonly color: string; readonly image?: SkImage };

export interface StaticPreviewLayer {
    readonly id: string;
    /** Web track order. Lower tracks are painted first. */
    readonly trackOrder: number;
    /** Stable tie-breaker for clips on the same track. */
    readonly clipOrder: number;
    /** Supplied images remain caller-owned. */
    readonly image?: SkImage;
    readonly crop: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
    readonly fit: 'contain' | 'cover';
    readonly transform: StaticPreviewTransform;
    readonly filter: StaticPreviewFilter;
    readonly blend: StaticPreviewBlend;
    readonly mask?: StaticPreviewMask;
    readonly background: StaticPreviewBackground;
    readonly unsupported?: readonly StaticPreviewUnsupportedFeature[];
}

export interface StaticPreviewPlan {
    readonly width: number;
    readonly height: number;
    /** Canonical web compositor geometry used to scale CSS-pixel filters into this output. */
    readonly referenceWidth: number;
    readonly referenceHeight: number;
    readonly background: string;
    readonly layers: readonly StaticPreviewLayer[];
    readonly unsupported?: readonly StaticPreviewUnsupportedFeature[];
}

export type StaticPreviewFailure =
    | { readonly ok: false; readonly code: 'invalid-plan'; readonly issues: readonly string[] }
    | { readonly ok: false; readonly code: 'unsupported'; readonly features: readonly StaticPreviewUnsupportedFeature[] };

/** On success the caller owns `image` and must call `image.dispose()` exactly once. */
export type StaticPreviewImageResult =
    | { readonly ok: true; readonly width: number; readonly height: number; readonly image: SkImage }
    | StaticPreviewFailure;

export type StaticPreviewResult =
    | { readonly ok: true; readonly width: number; readonly height: number; readonly rgba: Uint8Array }
    | StaticPreviewFailure;

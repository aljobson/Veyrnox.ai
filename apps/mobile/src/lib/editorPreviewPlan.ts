import { evaluatedParameters, evaluatedReveal, evaluatedTransform } from '../../../../app/veyrnox/_lib/editorAnimation.mjs';
import { audioClipInterval } from '../../../../app/veyrnox/_lib/editorAudioInterval.mjs';
import { colourDefaults, neutralColour } from '../../../../app/veyrnox/_lib/editorColour.mjs';
import { evaluatedMask } from '../../../../app/veyrnox/_lib/editorMask.mjs';
import { timelineSize } from '../../../../app/veyrnox/_lib/editorRender.mjs';
import { sequenceTransition, sequenceTransitionAfter } from '../../../../app/veyrnox/_lib/editorSequence.mjs';
import { sequenceLayers } from '../../../../app/veyrnox/_lib/editorSequenceRender.mjs';
import { trackAudible } from '../../../../app/veyrnox/_lib/editorSelection.mjs';
import { smartPictureActive } from '../../../../app/veyrnox/_lib/editorSmartPicture.mjs';
import { captionPresentation } from '../../../../app/veyrnox/_lib/editorWords.mjs';
import type { Clip, Media, TextClip, Timeline } from './nativeEditorModel';

type Transform = {
    x: number; y: number; scale: number; rotation: number; opacity: number; flipX: boolean; flipY: boolean;
};
type Reveal = { x: number; y: number; width: number; height: number };
type Filter = { brightness: number; contrast: number; saturate: number; hue: number; blur: number };
type Colour = ReturnType<typeof colourDefaults>;
type Mask = { x: number; y: number; width: number; height: number; rotation: number; feather: number; inverted: boolean };
type Wipe = { direction: string; progress: number };
type Shape = { kind: string; progress: number };

type CanonicalVisual = {
    clip: Clip; k: number; time: number; offset: number; alpha?: number; wipe?: Wipe;
    slideX?: number; slideY?: number; zoom?: number; transitionBlur?: number; flash?: number;
    spin?: number; shape?: Shape; leak?: number;
};
type CanonicalText = TextClip & { offset: number };
type CanonicalLayers = { visuals: CanonicalVisual[]; texts: CanonicalText[]; background: string };

export type EditorPreviewCapability =
    | 'timeline-background' | 'image-source' | 'graphic-source' | 'video-source' | 'missing-media' | 'unknown-media-source'
    | 'fit' | 'crop' | 'transform' | 'visual-layering' | 'blend' | 'mask' | 'transition' | 'clip-animation' | 'animation-reveal'
    | 'clip-background-solid' | 'clip-background-blur' | 'clip-background-image'
    | 'basic-filter' | 'smart-picture' | 'advanced-colour' | 'effect'
    | 'text-layer' | 'caption-words' | 'custom-font' | 'audio-mix';

export type EditorPreviewCapabilityUse = {
    capability: EditorPreviewCapability;
    supported: boolean;
    scope: 'timeline' | 'visual' | 'text' | 'audio';
    itemId?: string;
    mediaId?: string;
    detail?: string;
};

/** Capabilities the first static Skia compositor can consume without approximating web output. */
export const STATIC_EDITOR_PREVIEW_CAPABILITIES = Object.freeze([
    'timeline-background', 'image-source', 'graphic-source', 'fit', 'crop', 'transform', 'visual-layering', 'blend', 'mask', 'clip-animation',
    'clip-background-solid', 'clip-background-blur', 'clip-background-image', 'basic-filter',
] as const satisfies readonly EditorPreviewCapability[]);

/** What the current Expo image/video fallback actually draws before the Skia surface is mounted. */
export const LEGACY_EDITOR_PREVIEW_CAPABILITIES = Object.freeze([
    'timeline-background', 'image-source', 'video-source', 'fit', 'transform', 'clip-animation',
] as const satisfies readonly EditorPreviewCapability[]);

export type EditorPreviewTransition = {
    role: 'incoming' | 'outgoing';
    type: string;
    duration: number;
    progress: number;
    alpha: number;
    wipe: Wipe | null;
    slideX: number;
    slideY: number;
    zoom: number;
    blur: number;
    flash: number;
    spin: number;
    shape: Shape | null;
    lightLeak: number;
};

export type EditorPreviewVisualPlan = {
    layerIndex: number;
    clip: Clip;
    media: Media | null;
    sourceIndex: number;
    sourceTimeSeconds: number;
    offset: number;
    transform: Transform;
    reveal: Reveal;
    filter: Filter;
    colour: Colour;
    mask: Mask | null;
    crop: { x: number; y: number; width: number; height: number };
    fit: 'contain' | 'cover';
    blend: string;
    transition: EditorPreviewTransition | null;
};

export type EditorPreviewTextPlan = {
    layerIndex: number;
    item: TextClip;
    offset: number;
    transform: Transform;
    reveal: Reveal;
    presentation: { text: string; ranges: { from: number; to: number }[] };
};

export type EditorPreviewPlan = {
    frame: number;
    /** Canonical web compositor geometry at its 720p reference target. */
    referenceSize: { readonly width: number; readonly height: number };
    background: string;
    visuals: EditorPreviewVisualPlan[];
    texts: EditorPreviewTextPlan[];
    capabilities: {
        exact: boolean;
        requirements: EditorPreviewCapabilityUse[];
        unsupported: EditorPreviewCapabilityUse[];
    };
};

const fullReveal = (reveal: Reveal) => reveal.x === 0 && reveal.y === 0 && reveal.width === 1 && reveal.height === 1;
const neutralFilter = (filter: Filter) => filter.brightness === 1 && filter.contrast === 1 && filter.saturate === 1 && filter.hue === 0 && filter.blur === 0;
const fullCrop = (crop: EditorPreviewVisualPlan['crop']) => crop.x === 0 && crop.y === 0 && crop.width === 1 && crop.height === 1;
const activeAnimation = (clip: Clip) => !!clip.animation && [clip.animation.in, clip.animation.out, clip.animation.combo]
    .some(value => !!value && value !== 'none');

function transitionFor(timeline: Timeline, layers: CanonicalVisual[], index: number, frame: number): EditorPreviewTransition | null {
    const visual = layers[index];
    const normallyActive = frame >= visual.clip.start && frame < visual.clip.start + visual.clip.len;
    let incoming = visual;
    let role: EditorPreviewTransition['role'];
    if (normallyActive) {
        const duration = sequenceTransition(timeline, visual.k);
        if (!duration || visual.offset >= duration) return null;
        role = 'incoming';
    } else {
        incoming = layers[index + 1];
        if (!incoming || incoming.clip.trackId !== visual.clip.trackId) return null;
        role = 'outgoing';
    }
    const duration = sequenceTransition(timeline, incoming.k);
    if (!duration || incoming.offset < 0 || incoming.offset >= duration) return null;
    return {
        role, type: incoming.clip.transitionType || 'dissolve', duration, progress: (incoming.offset + 1) / duration,
        alpha: visual.alpha ?? 1, wipe: visual.wipe ?? null, slideX: visual.slideX ?? 0, slideY: visual.slideY ?? 0,
        zoom: visual.zoom ?? 1, blur: visual.transitionBlur ?? 0, flash: visual.flash ?? 0, spin: visual.spin ?? 0,
        shape: visual.shape ?? null, lightLeak: visual.leak ?? 0,
    };
}

function capabilityUse(
    supported: ReadonlySet<EditorPreviewCapability>, capability: EditorPreviewCapability,
    scope: EditorPreviewCapabilityUse['scope'], itemId?: string, mediaId?: string, detail?: string,
): EditorPreviewCapabilityUse {
    return { capability, supported: supported.has(capability), scope, ...(itemId ? { itemId } : {}), ...(mediaId ? { mediaId } : {}), ...(detail ? { detail } : {}) };
}

/**
 * Adapts the canonical web compositor's frame selection and evaluators into a typed mobile plan.
 * Raw clips remain attached to every layer, while the capability report makes any field that the
 * selected renderer cannot reproduce explicit instead of silently omitting it.
 */
export function editorPreviewPlan(
    timeline: Timeline,
    frame: number,
    supportedCapabilities: readonly EditorPreviewCapability[] = STATIC_EDITOR_PREVIEW_CAPABILITIES,
): EditorPreviewPlan {
    // Native drafts may temporarily retain a clip after its media disappears. The canonical web
    // selector assumes a validated document and dereferences every visual's media before filtering
    // by frame, so adapt only resolvable visuals and report relevant orphans below.
    const resolvableVideo = timeline.video.filter(clip => !!(clip.mediaId && timeline.media[clip.mediaId]));
    const canonicalTimeline = resolvableVideo.length === timeline.video.length ? timeline : { ...timeline, video: resolvableVideo };
    const sourceIndexes = new Map(timeline.video.map((clip, index) => [clip.id, index]));
    const canonical = sequenceLayers(canonicalTimeline, frame) as CanonicalLayers;
    const supported = new Set(supportedCapabilities);
    const requirements: EditorPreviewCapabilityUse[] = [capabilityUse(supported, 'timeline-background', 'timeline')];

    for (const clip of timeline.video) {
        if (clip.mediaId && timeline.media[clip.mediaId]) continue;
        const track = timeline.tracks.find(candidate => candidate.id === clip.trackId);
        const active = !track?.hidden && frame >= clip.start && frame < clip.start + clip.len;
        const incomingIndex = timeline.video.findIndex(candidate => candidate.trackId === clip.trackId && candidate.start === clip.start + clip.len);
        const transition = incomingIndex < 0 ? 0 : sequenceTransition(timeline, incomingIndex);
        const transitionTail = !track?.hidden && transition > 0 && frame >= clip.start + clip.len && frame < clip.start + clip.len + transition;
        if (active || transitionTail) requirements.push(capabilityUse(supported, 'missing-media', 'visual', clip.id, clip.mediaId));
    }

    const visuals = canonical.visuals.map((visual, layerIndex): EditorPreviewVisualPlan => {
        const { clip } = visual, media = clip.mediaId ? timeline.media[clip.mediaId] ?? null : null;
        const transform = evaluatedTransform(clip, visual.offset) as Transform;
        const reveal = evaluatedReveal(clip, visual.offset) as Reveal;
        const parameters = evaluatedParameters(clip, visual.offset) as { filter: Filter; colour: Colour };
        const mask = clip.mask && clip.mask !== 'none' ? evaluatedMask(clip, visual.offset) as Mask : null;
        const transition = transitionFor(canonicalTimeline, canonical.visuals, layerIndex, frame);
        const owner = ['image', 'graphic'].includes(String(media?.kind)) ? `${media?.kind}-source` as 'image-source' | 'graphic-source'
            : media?.kind === 'video' ? 'video-source' : media ? 'unknown-media-source' : 'missing-media';
        requirements.push(capabilityUse(supported, owner, 'visual', clip.id, clip.mediaId, media?.kind));
        requirements.push(capabilityUse(supported, 'fit', 'visual', clip.id, clip.mediaId, clip.fit || 'contain'));
        const crop = clip.crop || { x: 0, y: 0, width: 1, height: 1 };
        if (!fullCrop(crop)) requirements.push(capabilityUse(supported, 'crop', 'visual', clip.id, clip.mediaId));
        requirements.push(capabilityUse(supported, 'transform', 'visual', clip.id, clip.mediaId));
        if (clip.blend && clip.blend !== 'source-over') requirements.push(capabilityUse(supported, 'blend', 'visual', clip.id, clip.mediaId, clip.blend));
        if (mask) requirements.push(capabilityUse(supported, 'mask', 'visual', clip.id, clip.mediaId, clip.mask));
        if (transition) requirements.push(capabilityUse(supported, 'transition', 'visual', clip.id, clip.mediaId, transition.type));
        if (activeAnimation(clip)) requirements.push(capabilityUse(supported, 'clip-animation', 'visual', clip.id, clip.mediaId));
        if (!fullReveal(reveal)) requirements.push(capabilityUse(supported, 'animation-reveal', 'visual', clip.id, clip.mediaId));
        if (!neutralFilter(parameters.filter)) requirements.push(capabilityUse(supported, 'basic-filter', 'visual', clip.id, clip.mediaId));
        if (smartPictureActive(clip.smartPicture)) requirements.push(capabilityUse(supported, 'smart-picture', 'visual', clip.id, clip.mediaId));
        if (!neutralColour(parameters.colour)) requirements.push(capabilityUse(supported, 'advanced-colour', 'visual', clip.id, clip.mediaId));
        if (clip.effect && clip.effect.type !== 'none' && clip.effect.intensity > 0) requirements.push(capabilityUse(supported, 'effect', 'visual', clip.id, clip.mediaId, clip.effect.type));
        if (clip.background?.type && clip.background.type !== 'none') {
            const capability = `clip-background-${clip.background.type}` as 'clip-background-solid' | 'clip-background-blur' | 'clip-background-image';
            requirements.push(capabilityUse(supported, capability, 'visual', clip.id, clip.background.mediaId || clip.mediaId));
            if (clip.background.type === 'image' && !timeline.media[clip.background.mediaId]) requirements.push(capabilityUse(supported, 'missing-media', 'visual', clip.id, clip.background.mediaId, 'clip-background'));
        }
        return {
            layerIndex, clip, media, sourceIndex: sourceIndexes.get(clip.id) ?? visual.k, sourceTimeSeconds: visual.time, offset: visual.offset,
            transform, reveal, filter: parameters.filter, colour: parameters.colour, mask,
            crop, fit: clip.fit || 'contain', blend: clip.blend || 'source-over', transition,
        };
    });

    if (visuals.length > 1) requirements.push(capabilityUse(supported, 'visual-layering', 'timeline', undefined, undefined, String(visuals.length)));

    const texts = canonical.texts.map((item, layerIndex): EditorPreviewTextPlan => {
        const transform = evaluatedTransform(item, item.offset) as Transform;
        const reveal = evaluatedReveal(item, item.offset) as Reveal;
        const presentation = captionPresentation(item, item.offset) as EditorPreviewTextPlan['presentation'];
        requirements.push(capabilityUse(supported, 'text-layer', 'text', item.id));
        if (item.words?.length && (item.wordStyle?.mode ?? 'highlight') !== 'none') requirements.push(capabilityUse(supported, 'caption-words', 'text', item.id, undefined, item.wordStyle?.mode ?? 'highlight'));
        if (timeline.fonts?.some(font => font.family === item.style?.font)) requirements.push(capabilityUse(supported, 'custom-font', 'text', item.id, undefined, item.style?.font));
        if (!fullReveal(reveal)) requirements.push(capabilityUse(supported, 'animation-reveal', 'text', item.id));
        return { layerIndex, item, offset: item.offset, transform, reveal, presentation };
    });

    for (const clip of [...timeline.video, ...timeline.audio]) {
        const media = clip.mediaId ? timeline.media[clip.mediaId] : undefined;
        if (!media) {
            if (timeline.audio.includes(clip) && frame >= clip.start && frame < clip.start + clip.len && trackAudible(timeline, clip)) {
                requirements.push(capabilityUse(supported, 'missing-media', 'audio', clip.id, clip.mediaId));
            }
            continue;
        }
        if (!media.hasAudio || (clip.volume ?? 1) <= 0 || clip.freezeFrame !== undefined || !trackAudible(timeline, clip)) continue;
        const tail = timeline.video.includes(clip) ? sequenceTransitionAfter(timeline, clip) : 0;
        const interval = audioClipInterval(clip, media, tail);
        if (frame >= interval.startFrame && frame < interval.endFrame) requirements.push(capabilityUse(supported, 'audio-mix', 'audio', clip.id, clip.mediaId));
    }

    const unsupported = requirements.filter(requirement => !requirement.supported);
    return {
        frame,
        referenceSize: timelineSize(timeline, 720),
        background: canonical.background,
        visuals,
        texts,
        capabilities: { exact: unsupported.length === 0, requirements, unsupported },
    };
}

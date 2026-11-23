import { requireOptionalNativeModule } from 'expo-modules-core';
import { File } from 'expo-file-system';

export const EDITOR_PERSON_MASK_GATE = Object.freeze({
    ios: { available: true, minimumVersion: '16.4', engine: 'MediaPipe ImageSegmenter 1.0.1' },
    android: { available: false, reason: 'android-editor-semantic-mask-not-qualified' },
} as const);

export const EDITOR_PERSON_MASK_CATEGORIES = [
    'background', 'hair', 'bodySkin', 'faceSkin', 'clothes', 'others', 'person',
] as const;
export type EditorPersonMaskCategory = (typeof EDITOR_PERSON_MASK_CATEGORIES)[number];
export type EditorPersonMaskResult = { readonly ok: true; readonly width: number; readonly height: number;
    readonly masks: Readonly<Record<EditorPersonMaskCategory, Uint8Array>>; readonly pngs: Readonly<Record<EditorPersonMaskCategory, Uint8Array>> }
    | { readonly ok: false; readonly code: 'cancelled' | 'inference-busy' | 'inference-unavailable' | 'invalid-result' | 'unsupported-platform' };
export type EditorVideoPersonMaskResult = { readonly ok: true; readonly uri: string; readonly bytes: number; readonly width: number; readonly height: number;
    readonly frames: number; readonly fps: number; readonly durationSeconds: number; readonly videoCodec: 'avc1' }
    | { readonly ok: false; readonly code: 'cancelled' | 'inference-busy' | 'inference-unavailable' | 'invalid-result' | 'unsupported-platform' };

type NativeVision = {
    init(): Promise<void>;
    capabilities(): Promise<Record<string, unknown>>;
    detect(owner: string, token: string, operation: string, jpeg: string, width: number, height: number): Promise<Record<string, unknown>>;
    segmentVideo?(account: string, project: string, generation: number, owner: string, token: string, uri: string,
        sourceTimes: readonly number[], fps: number, category: string): Promise<Record<string, unknown>>;
    cancel(owner: string, token: string): void;
};

const identifier = () => `editor-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
const ownedEditorUri = (uri: unknown, account: string, project: string, prefix?: string) => {
    if (typeof uri !== 'string') return false;
    try { const value = new URL(uri), parts = decodeURIComponent(value.pathname).split('/').filter(Boolean), marker = parts.lastIndexOf('veyrnox-editor-media');
        return value.protocol === 'file:' && !value.host && !value.search && !value.hash && marker >= 0 && parts[marker + 1] === account
            && parts[marker + 2] === project && !parts.includes('..') && (!prefix || parts.at(-1)?.startsWith(prefix)); } catch { return false; }
};
const decode = (value: unknown, expected: number): Uint8Array | null => {
    if (typeof value !== 'string' || value.length > Math.ceil(expected / 3) * 4 + 4) return null;
    try {
        const bytes = Uint8Array.from(atob(value), character => character.charCodeAt(0));
        return bytes.length === expected ? bytes : null;
    } catch { return null; }
};
const decodePng = (value: unknown): Uint8Array | null => {
    if (typeof value !== 'string' || value.length > 1_400_000) return null;
    try { const bytes = Uint8Array.from(atob(value), character => character.charCodeAt(0));
        return bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => bytes[index] === byte) ? bytes : null; }
    catch { return null; }
};

function nativeVision(): NativeVision | null {
    try { return requireOptionalNativeModule<NativeVision>('VeyrnoxVision'); } catch { return null; }
}

/** Segment the exact source-time sequence for a moving clip into a bounded grayscale H.264 mask. */
export async function editorVideoPersonMask(account: string, project: string, generation: number, uri: string,
    sourceTimes: readonly number[], fps: number, category: EditorPersonMaskCategory,
    signal?: AbortSignal, native: NativeVision | null = nativeVision()): Promise<EditorVideoPersonMaskResult> {
    const segmentVideo = native?.segmentVideo?.bind(native);
    if (!native || !segmentVideo) return { ok: false, code: 'unsupported-platform' };
    const owned = ownedEditorUri(uri, account, project);
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(account) || !/^[A-Za-z0-9_-]{1,100}$/.test(project) || !Number.isSafeInteger(generation) || generation < 0
        || !owned || ![24, 25, 30, 50, 60].includes(fps) || !EDITOR_PERSON_MASK_CATEGORIES.includes(category)
        || !sourceTimes.length || sourceTimes.length > 1_800 || sourceTimes.some(value => !Number.isFinite(value) || value < 0 || value > 10_000_000 / 30))
        return { ok: false, code: 'invalid-result' };
    const owner = identifier(), token = identifier(), abort = () => native.cancel(owner, token);
    signal?.addEventListener('abort', abort, { once: true });
    try {
        if (signal?.aborted) return { ok: false, code: 'cancelled' };
        const capability = await native.capabilities();
        if (capability.ok !== true || capability.platform !== 'ios' || capability.semanticMaskVideo !== true
            || capability.architecture !== 'expo-modules-new-architecture') return { ok: false, code: 'unsupported-platform' };
        await native.init(); const raw = await segmentVideo(account, project, generation, owner, token, uri, sourceTimes, fps, category);
        if (signal?.aborted || raw.cancelled === true) {
            if (ownedEditorUri(raw.uri, account, project, 'vx-semantic-mask-')) {
                try { const file = new File(raw.uri as string); if (file.exists) file.delete(); } catch { /* Native sweep is the final guard. */ }
            }
            return { ok: false, code: 'cancelled' };
        }
        if (raw.error === 'inference-busy') return { ok: false, code: 'inference-busy' };
        if (raw.ok !== true || !ownedEditorUri(raw.uri, account, project, 'vx-semantic-mask-') || !Number.isSafeInteger(raw.bytes) || Number(raw.bytes) < 1
            || Number(raw.bytes) > 25 * 1024 * 1024 || !Number.isSafeInteger(raw.width) || !Number.isSafeInteger(raw.height)
            || Number(raw.width) < 8 || Number(raw.height) < 8 || Number(raw.width) > 384 || Number(raw.height) > 384
            || raw.frames !== sourceTimes.length || raw.fps !== fps || raw.videoCodec !== 'avc1' || raw.generation !== generation
            || typeof raw.durationSeconds !== 'number' || Math.abs(raw.durationSeconds - sourceTimes.length / fps) > 1 / fps) return { ok: false, code: 'invalid-result' };
        return { ok: true, uri: raw.uri as string, bytes: Number(raw.bytes), width: Number(raw.width), height: Number(raw.height), frames: Number(raw.frames),
            fps, durationSeconds: raw.durationSeconds, videoCodec: 'avc1' };
    } catch { return signal?.aborted ? { ok: false, code: 'cancelled' } : { ok: false, code: 'inference-unavailable' }; }
    finally { signal?.removeEventListener('abort', abort); }
}

/** One bounded still-frame semantic inference. Every returned plane is copied and length-checked. */
export async function editorPersonMasks(jpegDataUrl: string, width: number, height: number, signal?: AbortSignal,
    native: NativeVision | null = nativeVision()): Promise<EditorPersonMaskResult> {
    if (!native) return { ok: false, code: 'unsupported-platform' };
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 8 || height < 8 || width > 384 || height > 384
        || typeof jpegDataUrl !== 'string' || jpegDataUrl.length > 900_000 || !jpegDataUrl.startsWith('data:image/jpeg;base64,')) return { ok: false, code: 'invalid-result' };
    const owner = identifier(), token = identifier();
    const abort = () => native.cancel(owner, token);
    signal?.addEventListener('abort', abort, { once: true });
    try {
        if (signal?.aborted) return { ok: false, code: 'cancelled' };
        const capability = await native.capabilities();
        if (capability.ok !== true || capability.platform !== 'ios' || capability.semanticMask !== true
            || capability.architecture !== 'expo-modules-new-architecture') return { ok: false, code: 'unsupported-platform' };
        await native.init();
        const raw = await native.detect(owner, token, 'semanticMask', jpegDataUrl, width, height);
        if (signal?.aborted || raw.cancelled === true) return { ok: false, code: 'cancelled' };
        if (raw.error === 'inference-busy') return { ok: false, code: 'inference-busy' };
        if (raw.error) return { ok: false, code: 'inference-unavailable' };
        if (raw.width !== width || raw.height !== height) return { ok: false, code: 'invalid-result' };
        const pairs = EDITOR_PERSON_MASK_CATEGORIES.map(category => [category, decode(raw[category], width * height)] as const);
        const rawPngs = raw.maskPngs && typeof raw.maskPngs === 'object' ? raw.maskPngs as Record<string, unknown> : {};
        const pngs = EDITOR_PERSON_MASK_CATEGORIES.map(category => [category, decodePng(rawPngs[category])] as const);
        if (pairs.some(([, bytes]) => !bytes) || pngs.some(([, bytes]) => !bytes)) return { ok: false, code: 'invalid-result' };
        return { ok: true, width, height, masks: Object.fromEntries(pairs) as Record<EditorPersonMaskCategory, Uint8Array>,
            pngs: Object.fromEntries(pngs) as Record<EditorPersonMaskCategory, Uint8Array> };
    } catch { return signal?.aborted ? { ok: false, code: 'cancelled' } : { ok: false, code: 'inference-unavailable' }; }
    finally { signal?.removeEventListener('abort', abort); }
}

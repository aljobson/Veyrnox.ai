import { requireOptionalNativeModule } from 'expo-modules-core';
import type { FrameDescriptor } from './editorMedia/protocol';
import { CANONICAL_EDITOR_COMPOSITOR_CAPABILITIES, type EditorCompositorFrame } from './editorLocalExport';
import { advancedAudioMixClips } from '../../../../app/veyrnox/_lib/editorAdvancedAudioContract.mjs';
import { editorMedia } from './editorMedia';
import { framesIn, type Timeline } from './nativeEditorModel';
import type { EditorLocalExportDependencies } from './editorLocalExport';

type NativeCompositor = {
    capabilities(): Promise<Record<string, unknown>>;
    renderFrame(account: string, project: string, owner: string, token: string, planJSON: string,
        sources: Readonly<Record<string, string>>, width: number, height: number, index: number, timestampUs: number): Promise<Record<string, unknown>>;
    discardFrames(account: string, project: string, owner: string, token: string, uris: readonly string[]): void;
};
export type EditorCompositorSourceMap = Readonly<Record<string, string>>;
export type EditorCompositorNativeResult = { readonly ok: true; readonly value: FrameDescriptor }
    | { readonly ok: false; readonly code: 'cancelled' | 'invalid-input' | 'unsupported-frame' | 'write-failed' | 'module-missing' };

const id = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
function loadNative(): NativeCompositor | null {
    try { return requireOptionalNativeModule<NativeCompositor>('VeyrnoxEditorCompositor'); } catch { return null; }
}
const safeSource = (uri: string) => {
    try { const value = new URL(uri); return value.protocol === 'file:' && !value.host && !value.search && !value.hash && !value.pathname.split('/').includes('..'); }
    catch { return false; }
};

export function createNativeEditorCompositor(account: string, project: string, sources: EditorCompositorSourceMap,
    native: NativeCompositor | null = loadNative()) {
    const owner = id('compositor');
    const render = async (frame: EditorCompositorFrame, signal: AbortSignal): Promise<FrameDescriptor> => {
        if (!native) throw Error('module-missing');
        if (signal.aborted) throw Object.assign(Error('cancelled'), { name: 'AbortError' });
        if (!/^[A-Za-z0-9_-]{1,100}$/.test(account) || !/^[A-Za-z0-9_-]{1,100}$/.test(project)
            || Object.keys(sources).length > 48 || Object.entries(sources).some(([mediaId, uri]) => !mediaId || mediaId.length > 100 || !safeSource(uri))) throw Error('invalid-input');
        const capability = await native.capabilities();
        const features = Array.isArray(capability.features) ? capability.features : null;
        if (capability.ok !== true || capability.platform !== 'ios' || capability.protocolVersion !== 2
            || !features || features.length !== CANONICAL_EDITOR_COMPOSITOR_CAPABILITIES.length
            || CANONICAL_EDITOR_COMPOSITOR_CAPABILITIES.some(feature => !features.includes(feature))) throw Error('module-missing');
        const planJSON = JSON.stringify(frame.plan);
        if (new TextEncoder().encode(planJSON).length > 256 * 1024) throw Error('invalid-input');
        const token = id('frame'), raw = await native.renderFrame(account, project, owner, token, planJSON, sources,
            frame.width, frame.height, frame.index, frame.timestampUs);
        if (signal.aborted) {
            if (typeof raw.uri === 'string' && safeSource(raw.uri)) {
                try { native.discardFrames(account, project, owner, id('late-discard'), [raw.uri]); } catch { /* Native sweep is the final guard. */ }
            }
            throw Object.assign(Error('cancelled'), { name: 'AbortError' });
        }
        if (raw.ok !== true) throw Error(raw.code === 'invalid-input' ? 'unsupported-frame' : 'write-failed');
        const descriptor = { version: raw.version, uri: raw.uri, index: raw.index, timestampUs: raw.timestampUs,
            byteLength: raw.byteLength, width: raw.width, height: raw.height, stride: raw.stride,
            pixelFormat: raw.pixelFormat, colorSpace: raw.colorSpace } as FrameDescriptor;
        // Validate structural S9 invariants directly; the live S9 session later enforces contiguous timestamps.
        if (descriptor.version !== 1 || descriptor.index !== frame.index || descriptor.timestampUs !== frame.timestampUs
            || descriptor.width !== frame.width || descriptor.height !== frame.height || descriptor.stride !== frame.width * 4
            || descriptor.byteLength !== frame.width * frame.height * 4 || descriptor.pixelFormat !== 'rgba8' || descriptor.colorSpace !== 'srgb'
            || !safeSource(descriptor.uri) || !Number.isSafeInteger(descriptor.byteLength)) throw Error('write-failed');
        return descriptor;
    };
    render.discard = (frames: readonly FrameDescriptor[]) => {
        if (!native || !frames.length) return;
        try { native.discardFrames(account, project, owner, id('discard'), frames.slice(0, 8).map(frame => frame.uri)); } catch { /* Cache sweep remains a final guard. */ }
    };
    return render;
}

export type NativeEditorCompositor = ReturnType<typeof createNativeEditorCompositor>;

/** Production dependency bundle: canonical plan -> native compositor -> fenced S9 writer. */
export function createNativeEditorLocalExportDependencies(account: string, project: string, timeline: Timeline,
    sources: EditorCompositorSourceMap): EditorLocalExportDependencies {
    const compositor = createNativeEditorCompositor(account, project, sources);
    return {
        renderFrame: compositor,
        discardFrames: compositor.discard,
        async prepareAudio(candidate, signal, progress) {
            if (candidate !== timeline) return { ok: false, code: 'invalid-input' };
            try {
                await editorMedia.setOwner(account);
                const clips = advancedAudioMixClips(timeline); progress(.05);
                const mixed = await editorMedia.mixAudio(project, { clips, sources, frames: framesIn(timeline), fps: timeline.fps },
                    value => progress(value.value), signal);
                return mixed.ok ? { ok: true, value: { artifactId: mixed.value.artifactId } } : mixed;
            } catch { return { ok: false, code: signal.aborted ? 'cancelled' : 'invalid-input' }; }
        },
        begin: request => editorMedia.beginEncode(project, request),
        append: (session, frames) => editorMedia.appendFrameBatch(session, [...frames]),
        finish: session => editorMedia.finishEncode(session),
        cancel: session => editorMedia.cancel(session),
        release: async artifactId => { await editorMedia.release(project, artifactId); },
    };
}

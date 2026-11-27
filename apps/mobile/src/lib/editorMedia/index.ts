import { Platform } from 'react-native';
import { optionalEditorMediaModule, type NativeEditorMediaModule, type NativeProgressEvent } from './native';
import { EDITOR_MEDIA_ERROR_CODES, parseCapability, parseError, parseFrameArtifact, parseMediaInfo, parseMp4Artifact, parsePcmArtifact, parseProgress, validateAudioMixRequest, validateBeginEncodeRequest,
    validateDecodePcmRequest, validateFrameBatch, validateOwnedFileUri, validateSampleFramesRequest, validIdentifier, type AudioMixRequest, type BeginEncodeRequest, type DecodePcmRequest,
    type EditorMediaCapability, type EditorMediaError, type EditorMediaInfo, type EditorMediaProgress, type EditorMediaResult, type EncodeSession, type FrameArtifact,
    type FrameDescriptor, type Mp4Artifact, type PcmArtifact, type SampleFramesRequest } from './protocol';
export * from './protocol';
export type { NativeEditorMediaModule, NativeProgressEvent } from './native';
type ProgressListener = (progress: EditorMediaProgress) => void;
type Entry = { account: string; project: string; token: string; generation: number; listener?: ProgressListener; lastStage: number; lastValue: number;
    audioArtifactId?: string; idleTimer?: ReturnType<typeof setTimeout> };
const stageIndex: Record<string, number> = { preparing: 0, decoding: 1, encoding: 2, finishing: 3 };
const invalid: EditorMediaError = { ok: false, code: 'invalid-input' }, missing: EditorMediaError = { ok: false, code: 'module-missing' };
const terminalAppendCodes = new Set<EditorMediaError['code']>(['cancelled', 'disk-full', 'write-failed']);
const ENCODE_IDLE_TIMEOUT_MS = 30_000;
let clientSequence = 0;
const safeError = (value: unknown): EditorMediaError => {
    const parsed = parseError(value); if (parsed) return parsed;
    if (value && typeof value === 'object') {
        const candidate = value as Record<string, unknown>;
        if (typeof candidate.code === 'string' && (EDITOR_MEDIA_ERROR_CODES as readonly string[]).includes(candidate.code))
            return parseError({ ok: false, code: candidate.code, reason: candidate.reason }) ?? { ok: false, code: 'write-failed' };
    }
    return { ok: false, code: 'write-failed' };
};
const nativeMethods = ['capabilities', 'setOwner', 'setProjectGeneration', 'inspect', 'sampleFrames', 'decodePcm', 'mixAudio', 'beginEncode', 'appendFrameBatch', 'finishEncode', 'cancel',
    'cancelProject', 'release', 'addListener'] as const;
const compatibleNative = (value: NativeEditorMediaModule | null) => value && nativeMethods.every(method => typeof value[method] === 'function') ? value : null;

export function createEditorMediaClient(provided: NativeEditorMediaModule | null = optionalEditorMediaModule()) {
    const native = compatibleNative(provided);
    const owner = `editor-media-${Date.now()}-${++clientSequence}`;
    let account: string | null = null, epoch = 0, closed = false, tokenSequence = 0, adopted = false;
    let ownerFence: { target: string | null; promise: Promise<void> } | null = null;
    const projects = new Map<string, number>(), active = new Map<string, Entry>();
    const clearIdleTimer = (entry: Entry) => {
        if (entry.idleTimer !== undefined) { clearTimeout(entry.idleTimer); entry.idleTimer = undefined; }
    };
    const removeEntry = (entry: Entry) => { clearIdleTimer(entry); if (active.get(entry.token) === entry) active.delete(entry.token); };
    const armIdleTimer = (entry: Entry) => {
        clearIdleTimer(entry); entry.idleTimer = setTimeout(() => { entry.idleTimer = undefined; if (active.get(entry.token) === entry) active.delete(entry.token); }, ENCODE_IDLE_TIMEOUT_MS);
    };
    const subscription = native?.addListener?.('progress', event => {
        const item = active.get(event.token), progress = parseProgress(event);
        if (!item || !progress || event.owner !== owner || event.account !== item.account || event.project !== item.project || item.generation !== projects.get(item.project)) return;
        const nextStage = stageIndex[progress.stage]; if (nextStage < item.lastStage || progress.value < item.lastValue) return;
        item.lastStage = nextStage; item.lastValue = progress.value; item.listener?.(progress);
    });
    const begin = (project: string, listener?: ProgressListener) => {
        if (!account || closed || !validIdentifier(project)) return null;
        const generation = projects.get(project) ?? 0, token = `${Date.now()}-${++tokenSequence}`; if (!projects.has(project)) projects.set(project, generation);
        const entry: Entry = { account, project, token, generation, listener, lastStage: -1, lastValue: -1 }; active.set(token, entry); return entry;
    };
    const live = (entry: Entry) => !closed && account === entry.account && projects.get(entry.project) === entry.generation && active.has(entry.token);
    const releaseLateArtifact = async (entry: Entry, raw: unknown) => {
        if (!native || !raw || typeof raw !== 'object' || !validIdentifier((raw as Record<string, unknown>).artifactId)) return;
        try { await native.release(entry.account, entry.project, (raw as Record<string, unknown>).artifactId as string); } catch { /* Native owner cleanup may already have removed it. */ }
    };
    const setGeneration = async (project: string, generation: number) => {
        if (!account || !validIdentifier(project) || !Number.isSafeInteger(generation) || generation < 0) throw Error('invalid-input'); projects.set(project, generation);
        for (const item of [...active.values()]) if (item.project === project && item.generation !== generation) { try { native?.cancel(item.account, project, owner, item.token); }
            catch { /* teardown */ } removeEntry(item); }
        if (native) await native.setProjectGeneration(account, project, generation);
    };
    const once = async <T>(project: string, listener: ProgressListener | undefined, invoke: (entry: Entry) => Promise<unknown>, parse: (value: unknown) => T | null,
        signal?: AbortSignal): Promise<EditorMediaResult<T>> => {
        if (signal?.aborted) return { ok: false, code: 'cancelled' };
        if (!native) return missing; const entry = begin(project, listener); if (!entry) return invalid;
        const abort = () => { try { native.cancel(entry.account, project, owner, entry.token); } catch { /* teardown */ } removeEntry(entry); };
        signal?.addEventListener('abort', abort, { once: true });
        try { if (signal?.aborted) { abort(); return { ok: false, code: 'cancelled' }; }
            const raw = await invoke(entry); if (!live(entry)) { await releaseLateArtifact(entry, raw); return { ok: false, code: 'cancelled' }; } const error = parseError(raw); if (error) return error;
            const value = parse(raw); if (!value) { await releaseLateArtifact(entry, raw); return { ok: false, code: 'write-failed' }; } return { ok: true, value };
        } catch (error) { return live(entry) ? safeError(error) : { ok: false, code: 'cancelled' }; }
        finally { signal?.removeEventListener('abort', abort); removeEntry(entry); }
    };
    return {
        async capabilities(): Promise<EditorMediaCapability> {
            if (!native) return parseCapability({ ok: true, available: false, platform: Platform.OS === 'android' ? 'android' : 'ios', protocolVersion: 1, reason: 'module-missing', operations: {} });
            try { return parseCapability(await native.capabilities()); } catch { return parseCapability(null, true); }
        },
        async setOwner(next: string | null) {
            if (next !== null && !validIdentifier(next)) throw Error('invalid-input');
            if (next === account && ownerFence?.target === next) return ownerFence.promise;
            if (next === account && adopted) return;
            epoch++; account = next; adopted = false; projects.clear(); for (const item of [...active.values()]) { try { native?.cancel(item.account, item.project, owner, item.token); }
                catch { /* teardown */ } removeEntry(item); }
            const clientEpoch = epoch;
            const promise = native ? native.setOwner(next, owner, clientEpoch) : Promise.resolve();
            const fence = { target: next, promise }; ownerFence = fence;
            try { await promise; if (ownerFence === fence && account === next && epoch === clientEpoch) adopted = true; }
            finally { if (ownerFence === fence) ownerFence = null; }
        },
        async setProjectGeneration(project: string, generation: number) {
            await setGeneration(project, generation);
        },
        async bumpProjectGeneration(project: string) {
            if (!account || !validIdentifier(project)) throw Error('invalid-input');
            const generation = (projects.get(project) ?? 0) + 1; await setGeneration(project, generation); return generation;
        },
        projectGeneration(project: string) {
            return account && validIdentifier(project) ? projects.get(project) ?? 0 : null;
        },
        inspect(project: string, uri: string, listener?: ProgressListener, signal?: AbortSignal): Promise<EditorMediaResult<EditorMediaInfo>> {
            return validIdentifier(project) && validateOwnedFileUri(uri)
                ? once(project, listener, entry => native!.inspect(entry.account, project, owner, entry.token, uri), parseMediaInfo, signal) : Promise.resolve(invalid);
        },
        sampleFrames(project: string, request: SampleFramesRequest, listener?: ProgressListener, signal?: AbortSignal): Promise<EditorMediaResult<FrameArtifact>> {
            return validateSampleFramesRequest(request) ? once(project, listener, entry => native!.sampleFrames(entry.account, project, owner, entry.token, request),
                value => parseFrameArtifact(value, request), signal)
                : Promise.resolve(invalid);
        },
        decodePcm(project: string, request: DecodePcmRequest, listener?: ProgressListener, signal?: AbortSignal): Promise<EditorMediaResult<PcmArtifact>> {
            return validateDecodePcmRequest(request) ? once(project, listener, entry => native!.decodePcm(entry.account, project, owner, entry.token, request),
                value => parsePcmArtifact(value, request.mixMode), signal)
                : Promise.resolve(invalid);
        },
        mixAudio(project: string, request: AudioMixRequest, listener?: ProgressListener, signal?: AbortSignal): Promise<EditorMediaResult<PcmArtifact>> {
            return validateAudioMixRequest(request) ? once(project, listener, entry => native!.mixAudio(entry.account, project, owner, entry.token,
                JSON.stringify(request.clips), request.sources, request.frames, request.fps), value => parsePcmArtifact(value), signal)
                : Promise.resolve(invalid);
        },
        async beginEncode(project: string, request: BeginEncodeRequest, listener?: ProgressListener): Promise<EditorMediaResult<EncodeSession>> {
            if (!native) return missing; if (!validateBeginEncodeRequest(request)) return invalid; const entry = begin(project, listener); if (!entry) return invalid;
            entry.audioArtifactId = request.audioArtifactId;
            try { const raw = await native.beginEncode(entry.account, project, owner, entry.token, request); if (!live(entry)) return { ok: false, code: 'cancelled' };
                const error = parseError(raw); if (error) { removeEntry(entry); return error; }
                if (!raw || raw.ok !== true || typeof raw.sessionId !== 'string' || !validIdentifier(raw.sessionId)) { removeEntry(entry); return { ok: false, code: 'write-failed' }; }
                armIdleTimer(entry);
                return { ok: true, value: { sessionId: raw.sessionId, token: entry.token, project, generation: entry.generation, width: request.width,
                    height: request.height, fps: request.fps, nextIndex: 0, ...(request.audioArtifactId ? { audioArtifactId: request.audioArtifactId } : {}),
                    ...(request.codec ? { codec: request.codec } : {}),
                    ...(request.alpha ? { alpha: true } : {}) } };
            } catch (error) { const wasLive = live(entry); removeEntry(entry); return wasLive ? safeError(error) : { ok: false, code: 'cancelled' }; }
        },
        async appendFrameBatch(session: EncodeSession, frames: FrameDescriptor[]): Promise<EditorMediaResult<EncodeSession>> {
            if (!native) return missing; const item = active.get(session.token); if (!item || !live(item)) return { ok: false, code: 'cancelled' };
            if (!validateFrameBatch(frames, session)) return invalid;
            clearIdleTimer(item);
            try { const raw = await native.appendFrameBatch(item.account, session.project, owner, session.token, session.sessionId, frames); if (!live(item)) return { ok: false, code: 'cancelled' };
                const error = parseError(raw); if (error) { if (terminalAppendCodes.has(error.code)) removeEntry(item); else armIdleTimer(item); return error; }
                if (raw?.ok !== true) { removeEntry(item); return { ok: false, code: 'write-failed' }; }
                armIdleTimer(item);
                return { ok: true, value: { ...session, nextIndex: session.nextIndex + frames.length } };
            } catch (error) { if (!live(item)) return { ok: false, code: 'cancelled' }; const result = safeError(error);
                if (terminalAppendCodes.has(result.code)) removeEntry(item); else armIdleTimer(item); return result; }
        },
        async finishEncode(session: EncodeSession): Promise<EditorMediaResult<Mp4Artifact>> {
            if (!native) return missing; const item = active.get(session.token); if (!item || !live(item)) return { ok: false, code: 'cancelled' };
            clearIdleTimer(item);
            try { const raw = await native.finishEncode(item.account, session.project, owner, session.token, session.sessionId, null);
                if (!live(item)) { await releaseLateArtifact(item, raw); return { ok: false, code: 'cancelled' }; } const error = parseError(raw); if (error) return error;
                const value = parseMp4Artifact(raw), expectedAudio = session.audioArtifactId !== undefined;
                return value && expectedAudio === (value.audioCodec === 'mp4a')
                    && value.videoCodec === (session.alpha ? 'hvc1-alpha' : session.codec === 'hevc' ? 'hvc1' : 'avc1')
                    ? { ok: true, value } : { ok: false, code: 'write-failed' };
            } catch (error) { return live(item) ? safeError(error) : { ok: false, code: 'cancelled' }; }
            finally { removeEntry(item); }
        },
        cancel(session: EncodeSession) { const item = active.get(session.token); if (!item) return; removeEntry(item);
            try { native?.cancel(item.account, session.project, owner, session.token); } catch { /* teardown */ } },
        async cancelProject(project: string) {
            if (!account || !validIdentifier(project)) return; projects.set(project, (projects.get(project) ?? 0) + 1);
            for (const item of [...active.values()]) if (item.project === project) { try { native?.cancel(item.account, project, owner, item.token); } catch { /* teardown */ }
                removeEntry(item); } await native?.cancelProject(account, project).catch(() => undefined);
        },
        async release(project: string, artifactId: string): Promise<EditorMediaResult<null>> {
            if (!account || !validIdentifier(project) || !validIdentifier(artifactId)) return invalid; if (!native) return missing;
            if ([...active.values()].some(item => item.project === project && item.audioArtifactId === artifactId)) return { ok: false, code: 'busy' };
            try { await native.release(account, project, artifactId); return { ok: true, value: null }; } catch (error) { return safeError(error); }
        },
        close() { if (closed) return; closed = true; epoch++; for (const item of [...active.values()]) { try { native?.cancel(item.account, item.project, owner, item.token); }
            catch { /* teardown */ } removeEntry(item); } projects.clear(); subscription?.remove(); },
        get epoch() { return epoch; },
    };
}
export const editorMedia = createEditorMediaClient();

import { requireOptionalNativeModule } from 'expo-modules-core';
import { insertCaptions } from '../../../../app/veyrnox/_lib/editorCaptions.mjs';
import type { Timeline } from './nativeEditorModel';

export type EditorSpeechPermission = 'not-determined' | 'authorized' | 'denied' | 'restricted' | 'revoked';
export type EditorSpeechCapability = { readonly platform: 'ios' | 'android'; readonly automaticCaptions: boolean;
    readonly onDeviceRecognition: boolean; readonly translation: boolean; readonly minimumIos: '16.4'; readonly translationGate?: string };
export type EditorSpeechSegment = { readonly text: string; readonly startMs: number; readonly durationMs: number; readonly estimated?: true };
export type EditorSpeechTranscript = { readonly locale: string; readonly text: string; readonly onDevice: true; readonly segments: readonly EditorSpeechSegment[] };
export type EditorTranslatedTranscript = EditorSpeechTranscript & { readonly sourceLocale: string; readonly locale: string };
export type EditorSpeechResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly code:
    'module-missing' | 'unsupported-platform' | 'permission-denied' | 'permission-restricted' | 'permission-revoked' | 'on-device-unavailable'
    | 'busy' | 'cancelled' | 'invalid-input' | 'recognition-failed' | 'invalid-result' };
type EditorSpeechErrorCode = Extract<EditorSpeechResult<never>, { ok: false }>['code'];

type NativeSpeech = {
    permission(): Promise<Record<string, unknown>>;
    requestPermission(): Promise<Record<string, unknown>>;
    capabilities(locale: string): Promise<Record<string, unknown>>;
    transcribe(account: string, project: string, owner: string, token: string, uri: string, locale: string): Promise<Record<string, unknown>>;
    transcribePcm(account: string, project: string, owner: string, token: string, artifactId: string, locale: string): Promise<Record<string, unknown>>;
    translate(sourceLocale: string, targetLocale: string, texts: readonly string[]): Promise<Record<string, unknown>>;
    cancel(token: string): void;
};

const permissions = new Set<EditorSpeechPermission>(['not-determined', 'authorized', 'denied', 'restricted', 'revoked']);
const token = () => `speech-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
const identifier = (value: string) => /^[A-Za-z0-9_-]{1,100}$/.test(value);
function nativeSpeech(): NativeSpeech | null { try { return requireOptionalNativeModule<NativeSpeech>('VeyrnoxEditorSpeech'); } catch { return null; } }

function speechCues(segments: readonly EditorSpeechSegment[]) {
    const grouped: EditorSpeechSegment[][] = [];
    for (const segment of segments) {
        const current = grouped.at(-1), first = current?.[0];
        if (!current || current.length >= 8 || !first || segment.startMs + segment.durationMs - first.startMs > 4_000) grouped.push([segment]);
        else current.push(segment);
    }
    return grouped.map(words => ({ words, startMs: words[0].startMs,
        endMs: Math.max(...words.map(word => word.startMs + word.durationMs)), text: words.map(word => word.text).join(' ') }));
}

function estimatedCueSegments(text: string, startMs: number, endMs: number): EditorSpeechSegment[] {
    const words = text.trim().split(/\s+/u), span = Math.max(1, endMs - startMs);
    return words.map((word, index) => {
        const start = startMs + Math.round(span * index / words.length), end = startMs + Math.round(span * (index + 1) / words.length);
        return { text: word, startMs: start, durationMs: Math.max(1, end - start), estimated: true };
    });
}

function transcriptResult(raw: Record<string, unknown>, locale: string): EditorSpeechResult<EditorSpeechTranscript> {
    if (raw.ok !== true) { const code = String(raw.code); return { ok: false, code: ['permission-denied', 'on-device-unavailable', 'busy', 'cancelled', 'invalid-input', 'recognition-failed'].includes(code)
        ? code as EditorSpeechErrorCode : 'invalid-result' }; }
    if (raw.onDevice !== true || raw.locale !== locale || typeof raw.text !== 'string' || !Array.isArray(raw.segments) || raw.segments.length > 1_000) return { ok: false, code: 'invalid-result' };
    const segments: EditorSpeechSegment[] = [];
    for (const item of raw.segments) {
        if (!item || typeof item !== 'object') return { ok: false, code: 'invalid-result' };
        const value = item as Record<string, unknown>;
        if (typeof value.text !== 'string' || !value.text.trim() || value.text.length > 200 || !Number.isSafeInteger(value.startMs)
            || Number(value.startMs) < 0 || !Number.isSafeInteger(value.durationMs) || Number(value.durationMs) < 1) return { ok: false, code: 'invalid-result' };
        segments.push({ text: value.text, startMs: Number(value.startMs), durationMs: Number(value.durationMs) });
    }
    return { ok: true, value: { locale, text: raw.text, onDevice: true, segments } };
}

export function createEditorSpeechClient(native: NativeSpeech | null = nativeSpeech()) {
    const permission = async (request = false): Promise<EditorSpeechPermission> => {
        if (!native) return 'restricted';
        try { const raw = await (request ? native.requestPermission() : native.permission());
            return permissions.has(raw.permission as EditorSpeechPermission) ? raw.permission as EditorSpeechPermission : 'restricted'; }
        catch { return 'restricted'; }
    };
    const recognize = async (account: string, project: string, source: string, locale: string, kind: 'uri' | 'pcm', signal?: AbortSignal): Promise<EditorSpeechResult<EditorSpeechTranscript>> => {
        if (!native) return { ok: false, code: 'module-missing' };
        if (![account, project].every(identifier) || (kind === 'uri' ? !source.startsWith('file:') : !identifier(source)) || !locale || locale.length > 80) return { ok: false, code: 'invalid-input' };
        const state = await permission(false);
        if (state !== 'authorized') return { ok: false, code: state === 'revoked' ? 'permission-revoked' : state === 'restricted' ? 'permission-restricted' : 'permission-denied' };
        const owner = token(), run = token(), abort = () => native.cancel(run);
        signal?.addEventListener('abort', abort, { once: true });
        try {
            if (signal?.aborted) return { ok: false, code: 'cancelled' };
            const raw = kind === 'uri' ? await native.transcribe(account, project, owner, run, source, locale)
                : await native.transcribePcm(account, project, owner, run, source, locale);
            if (signal?.aborted) return { ok: false, code: 'cancelled' };
            return transcriptResult(raw, locale);
        } catch { return signal?.aborted ? { ok: false, code: 'cancelled' } : { ok: false, code: 'recognition-failed' }; }
        finally { signal?.removeEventListener('abort', abort); }
    };
    return {
        permission,
        capabilities: async (locale: string): Promise<EditorSpeechCapability> => {
            if (!native || !locale || locale.length > 80) return { platform: 'android', minimumIos: '16.4', automaticCaptions: false,
                onDeviceRecognition: false, translation: false, translationGate: 'native-speech-module-missing' };
            try { const raw = await native.capabilities(locale); return { platform: raw.platform === 'ios' ? 'ios' : 'android', minimumIos: '16.4',
                automaticCaptions: raw.automaticCaptions === true, onDeviceRecognition: raw.onDeviceRecognition === true,
                translation: raw.translation === true, ...(typeof raw.translationGate === 'string' ? { translationGate: raw.translationGate } : {}) }; }
            catch { return { platform: 'android', minimumIos: '16.4', automaticCaptions: false, onDeviceRecognition: false, translation: false,
                translationGate: 'native-speech-module-missing' }; }
        },
        transcribe: (account: string, project: string, uri: string, locale: string, signal?: AbortSignal) =>
            recognize(account, project, uri, locale, 'uri', signal),
        /** Transcribe an owned editorMedia.mixAudio artifact without exposing headerless PCM to Speech. */
        transcribePcm: (account: string, project: string, artifactId: string, locale: string, signal?: AbortSignal) =>
            recognize(account, project, artifactId, locale, 'pcm', signal),
        translate: async (transcript: EditorSpeechTranscript, targetLocale: string): Promise<EditorSpeechResult<EditorTranslatedTranscript>> => {
            if (!native) return { ok: false, code: 'module-missing' };
            if (!targetLocale || targetLocale.length > 80 || !transcript.segments.length || transcript.segments.length > 1_000) return { ok: false, code: 'invalid-input' };
            try {
                const capability = await native.capabilities(transcript.locale);
                if (capability.platform !== 'ios' || capability.translation !== true) return { ok: false, code: 'unsupported-platform' };
                const cues = speechCues(transcript.segments);
                if (!cues.length || cues.length > 1_000) return { ok: false, code: 'invalid-input' };
                const sourceTexts = cues.map(cue => cue.text), translated: string[] = [];
                for (let start = 0; start < sourceTexts.length; start += 150) {
                    const batch = sourceTexts.slice(start, start + 150), raw = await native.translate(transcript.locale, targetLocale, batch);
                    if (raw.ok !== true) return { ok: false, code: raw.code === 'invalid-input' ? 'invalid-input' : 'on-device-unavailable' };
                    if (raw.onDevice !== true || raw.sourceLocale !== transcript.locale || raw.targetLocale !== targetLocale || !Array.isArray(raw.texts)
                        || raw.texts.length !== batch.length || raw.texts.some(text => typeof text !== 'string' || !text.trim() || text.length > 1_000)) return { ok: false, code: 'invalid-result' };
                    translated.push(...raw.texts as string[]);
                }
                const segments = cues.flatMap((cue, index) => estimatedCueSegments(translated[index], cue.startMs, cue.endMs));
                if (segments.length > 1_000) return { ok: false, code: 'invalid-result' };
                return { ok: true, value: { ...transcript, sourceLocale: transcript.locale, locale: targetLocale,
                    text: translated.join(' '), segments } };
            } catch { return { ok: false, code: 'on-device-unavailable' }; }
        },
    };
}

/** Convert Apple's timed words into ordinary web-compatible editable caption clips. */
export function insertAutomaticCaptions(timeline: Timeline, transcript: EditorSpeechTranscript): Timeline | null {
    const grouped = speechCues(transcript.segments).map(cue => cue.words);
    if (!grouped.length || grouped.length > 150) return null;
    const cues = grouped.map(words => {
        const startMs = words[0].startMs, endMs = Math.max(...words.map(word => word.startMs + word.durationMs));
        const start = Math.round(startMs * timeline.fps / 1_000), len = Math.max(1, Math.round(endMs * timeline.fps / 1_000) - start);
        return { start, len, text: words.map(word => word.text).join(' '), words: words.map(word => ({ text: word.text,
            start: Math.max(0, Math.round((word.startMs - startMs) * timeline.fps / 1_000)),
            len: Math.max(1, Math.round(word.durationMs * timeline.fps / 1_000)) })), wordsEstimated: words.some(word => word.estimated === true) };
    });
    const result = insertCaptions(timeline, cues) as Timeline | { error: string };
    return 'error' in result ? null : result;
}

import type { AudioAsset } from './labs';
// @ts-ignore shared bounded streaming loader, including probe, frame count and checkDecoded
import * as audioFetch from '../../../../../app/veyrnox/_lib/music/beat/beatAudioFetch.mjs';

export type DecodedAudio = { numberOfChannels: number; sampleRate: number; length: number };
export type RemoteSongBase = { id: string; version_id: string; job_id: string; title: string };
export type PreparedRemoteSong = { asset: AudioAsset; buffer: DecodedAudio };
export type RemoteSongDeps = {
    sign(jobId: string, signal: AbortSignal): Promise<{ url: string }>;
    fetchAudio: typeof fetch;
    decode(bytes: ArrayBuffer): Promise<DecodedAudio>;
    current(): boolean;
};

export const fetchAudioAsset = (audioFetch as unknown as {
    fetchAudioAsset(url: string, base: Omit<AudioAsset, 'durationSec' | 'sourceChannels' | 'encodedBytes'>, stored: null,
        deps: { fetchAudio: typeof fetch; decode(bytes: ArrayBuffer): Promise<DecodedAudio> }): Promise<PreparedRemoteSong>;
}).fetchAudioAsset;

const stopped = () => Object.assign(new Error('aborted'), { name: 'AbortError' });
const changed = () => Object.assign(new Error('account_changed'), { status: 401, code: 'account_changed' });
const invalid = () => Object.assign(new Error('invalid_media'), { code: 'invalid_media' });
const invalidSignedUrl = () => Object.assign(new Error('invalid_signed_url'), { code: 'invalid_signed_url' });
export function assertRemoteSongActive(signal: AbortSignal, current: () => boolean): void {
    if (signal.aborted) throw signal.reason ?? stopped();
    if (!current()) throw changed();
}
function statusOf(error: unknown): number | undefined {
    let value: unknown = error;
    for (let depth = 0; depth < 4 && value && typeof value === 'object'; depth++) {
        const status = (value as { status?: unknown }).status;
        if (typeof status === 'number') return status;
        value = (value as { cause?: unknown }).cause;
    }
    return undefined;
}
export function secureRemoteSongUrl(value: unknown): string {
    if (typeof value !== 'string') throw invalidSignedUrl();
    try {
        const url = new URL(value);
        const localDevelopment = typeof __DEV__ !== 'undefined' && __DEV__ && url.protocol === 'http:'
            && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
        if (url.protocol !== 'https:' && !localDevelopment) throw invalidSignedUrl();
    }
    catch (error) { if ((error as { code?: string })?.code === 'invalid_signed_url') throw error; throw invalidSignedUrl(); }
    return value;
}
function transportError(error: unknown): never {
    if ((error as { name?: string })?.name === 'AbortError') throw error;
    throw Object.assign(new Error('network', { cause: error }), { status: 0, code: 'network' });
}

/** Loads one immutable private song through the shared bounded probe/stream/decode gates. */
export async function prepareRemoteSong(song: RemoteSongBase, deps: RemoteSongDeps, signal: AbortSignal): Promise<PreparedRemoteSong> {
    const base = { source: 'song' as const, ref: { songId: song.id, versionId: song.version_id, jobId: song.job_id },
        name: song.title.trim() ? song.title.slice(0, 80) : 'Untitled song', bpm: null };
    for (let attempt = 0; attempt < 2; attempt++) {
        assertRemoteSongActive(signal, deps.current);
        let signed: { url: string };
        try { signed = await deps.sign(song.job_id, signal); }
        catch (error) {
            assertRemoteSongActive(signal, deps.current);
            if (statusOf(error) !== undefined || typeof (error as { code?: unknown })?.code === 'string') throw error;
            transportError(error);
        }
        assertRemoteSongActive(signal, deps.current);
        const url = secureRemoteSongUrl(signed?.url);
        try {
            const prepared = await fetchAudioAsset(url, base, null, {
                fetchAudio: async (target, options) => {
                    assertRemoteSongActive(signal, deps.current);
                    let response: Response;
                    try { response = await deps.fetchAudio(target, { ...options, signal }); }
                    catch (error) { assertRemoteSongActive(signal, deps.current); transportError(error); }
                    assertRemoteSongActive(signal, deps.current);
                    const body = response.body;
                    return { ok: response.ok, status: response.status, headers: response.headers,
                        body: body && { cancel: () => body.cancel(), getReader() {
                            const reader = body.getReader();
                            return { async read() {
                                try { const result = await reader.read(); assertRemoteSongActive(signal, deps.current); return result; }
                                catch (error) { assertRemoteSongActive(signal, deps.current); transportError(error); }
                            }, cancel: () => reader.cancel(), releaseLock: () => reader.releaseLock?.() };
                        } },
                    } as unknown as Response;
                },
                decode: async bytes => {
                    assertRemoteSongActive(signal, deps.current);
                    const decoded = await deps.decode(bytes);
                    assertRemoteSongActive(signal, deps.current);
                    return decoded;
                },
            });
            assertRemoteSongActive(signal, deps.current);
            return prepared;
        } catch (error) {
            assertRemoteSongActive(signal, deps.current);
            if (attempt === 0 && [401, 403].includes(statusOf(error) ?? -1)) continue;
            throw error;
        }
    }
    throw invalid();
}

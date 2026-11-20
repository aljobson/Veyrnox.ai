import { createMediaFailures, mediaCode } from './takeMediaFailures';
import { ApiError, type ApiClient } from '../api';
import { encodeWav } from '../instrumentShared';
import { normalizeCloudError, type CloudOptions } from './cloud';
import type { BeatDoc } from './doc';
import { loadBeatTake, putBeatTake, recoverTake, takeAssets, type CloudTake, type Reservation } from './takeShared';
import { configureNativeTakeStorage } from './takeShared';
export type TakeCloudToken = CloudOptions & { current(): boolean };
const localOnly = () => new ApiError(400, 'TAKE_LOCAL_ONLY');
const check = (token: TakeCloudToken) => { if (!token.current() || token.signal?.aborted) throw new Error('account_changed'); };
export function decodeTakeWav(data: ArrayBuffer): { samples: Float32Array; sampleRate: number } {
    if (data.byteLength < 44 || data.byteLength > 60_000_000) throw new Error('invalid_wav');
    const view = new DataView(data), tag = (at: number) => String.fromCharCode(...new Uint8Array(data, at, 4));
    if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('invalid_wav');
    let sampleRate = 0, channels = 0, bits = 0, format = 0, start = 0, size = 0;
    for (let at = 12; at + 8 <= data.byteLength;) {
        const length = view.getUint32(at + 4, true), body = at + 8;
        if (body + length > data.byteLength) throw new Error('invalid_wav');
        if (tag(at) === 'fmt ' && length >= 16) { format = view.getUint16(body, true); channels = view.getUint16(body + 2, true); sampleRate = view.getUint32(body + 4, true); bits = view.getUint16(body + 14, true); }
        if (tag(at) === 'data') { start = body; size = length; }
        at = body + length + length % 2;
    }
    if (format !== 1 || channels !== 1 || bits !== 16 || !sampleRate || !size || size % 2 || size / 2 / sampleRate > 600) throw new Error('invalid_wav');
    const samples = new Float32Array(size / 2);
    for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(start + i * 2, true) / 32768;
    return { samples, sampleRate };
}
export function createTakeCloud(api: ApiClient, fetcher: typeof fetch = fetch, initialize = configureNativeTakeStorage) {
    const failures = createMediaFailures();
    async function call<T>(url: string, token: TakeCloudToken, body?: unknown): Promise<T> {
        check(token);
        try {
            const result = await api.request<T>(url, { signal: token.signal, ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) }, token.userId ? { owner: token.userId } : {});
            check(token); return result;
        } catch (error) { throw normalizeCloudError(error); }
    }
    const path = (id: string) => `/api/v1/music/beat-projects/${encodeURIComponent(id)}/takes`;
    async function list(id: string, token: TakeCloudToken) {
        const result = await call<{ takes: CloudTake[] }>(path(id), token);
        if (!Array.isArray(result?.takes) || !result.takes.every(r => typeof r.id === 'string' && typeof r.take_ref === 'string' && ['pending', 'ready'].includes(r.status))) throw new ApiError(200, 'bad_response');
        return result.takes;
    }
    async function upload(doc: BeatDoc, token: TakeCloudToken, strict = false) {
        const assets = takeAssets(doc); failures.retain(doc.id, assets.map(a => a.ref)); if (!assets.length) return true;
        const batch = `${doc.id}:upload:list`;
        if (!strict && failures.held(batch)) return false;
        let rows: CloudTake[];
        try { initialize(); rows = await list(doc.id, token); failures.ready(batch); }
        catch (error) { check(token); failures.fail(batch, error, strict); return false; }
        let all = true;
        for (const [index, asset] of assets.entries()) {
            const key = `${doc.id}:upload:${asset.ref}`;
            check(token); const row = rows.find(r => r.take_ref === asset.ref);
            if (row?.status === 'ready') { failures.ready(key); continue; }
            if (!strict && failures.held(key)) { all = false; continue; }
            let body: ArrayBuffer | undefined;
            try {
                await recoverTake({ row,
                    confirm: id => call(`${path(doc.id)}/${encodeURIComponent(id)}`, token, {}),
                    reserve: async () => {
                        const take = await loadBeatTake(asset.ref); check(token);
                        if (!take || 44 + take.samples.length * 2 > 60_000_000 || take.samples.length / take.sampleRate > 600) throw localOnly();
                        body = encodeWav(take.samples, take.sampleRate);
                        return call<Reservation>(path(doc.id), token, { take_ref: asset.ref, byte_size: body.byteLength, duration_sec: take.samples.length / take.sampleRate });
                    },
                    put: async reservation => {
                        check(token);
                        try { const response = await fetcher(reservation.upload_url, { method: 'PUT', headers: reservation.upload_headers, body, signal: token.signal, credentials: 'omit' }); check(token); return response; }
                        catch (error) { check(token); if (error instanceof ApiError) throw error; throw new ApiError(0, 'NETWORK_ERROR'); }
                    },
                });
                failures.ready(key);
            } catch (error) {
                check(token); all = false; failures.fail(key, error, strict);
                const code = mediaCode(error);
                if (code === 'LIMIT_REACHED') { assets.slice(index).forEach(a => failures.refuse(`${doc.id}:upload:${a.ref}`)); break; }
                if (code === 'RATE_LIMITED' || (error as { status?: number })?.status === 429) { failures.defer(batch); break; }
            }
        }
        return all;
    }
    async function download(doc: BeatDoc, token: TakeCloudToken) {
        const assets = takeAssets(doc); failures.retain(doc.id, assets.map(a => a.ref)); if (!assets.length) return true;
        const batch = `${doc.id}:download:list`;
        if (failures.held(batch)) return false;
        const missing = []; let all = true;
        try { initialize(); } catch (error) { check(token); failures.fail(batch, error); return false; }
        for (const asset of assets) {
            const key = `${doc.id}:download:${asset.ref}`;
            try {
                if (await loadBeatTake(asset.ref)) failures.ready(key);
                else if (failures.held(key)) all = false;
                else missing.push(asset);
            }
            catch (error) { check(token); all = false; failures.fail(key, error); }
        }
        if (!missing.length) return all;
        let rows: CloudTake[];
        try { rows = await list(doc.id, token); failures.ready(batch); }
        catch (error) { check(token); failures.fail(batch, error); return false; }
        for (const asset of missing) {
            const key = `${doc.id}:download:${asset.ref}`;
            check(token); const row = rows.find(r => r.take_ref === asset.ref && r.status === 'ready');
            // Documents arrive before media is reserved or confirmed on the recording device.
            if (!row) { all = false; failures.defer(key); continue; }
            try {
                const signed = await call<{ url: string }>(`${path(doc.id)}/${encodeURIComponent(row.id)}`, token);
                if (typeof signed?.url !== 'string') throw new ApiError(200, 'bad_response');
                const networkError = (error: unknown): never => { throw error instanceof ApiError ? error : new ApiError(0, 'NETWORK_ERROR'); };
                const response = await fetcher(signed.url, { signal: token.signal, credentials: 'omit' }).catch(networkError);
                if (!response.ok) throw new ApiError(response.status, 'TAKE_DOWNLOAD_FAILED');
                const decoded = decodeTakeWav(await response.arrayBuffer().catch(networkError)); check(token);
                await putBeatTake({ ...decoded, id: asset.ref, beatId: doc.id, label: asset.name, length: decoded.samples.length, createdAt: Date.now(), state: 'committed' }, () => check(token));
                failures.ready(key);
            } catch (error) { check(token); all = false; failures.fail(key, error); }
        }
        return all;
    }
    return { upload, download, list, nextRetryAt: failures.nextRetryAt, reset: failures.reset };
}

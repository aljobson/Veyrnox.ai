import { createBeat } from '../../src/lib/beatNative/doc';
import type { ApiClient } from '../../src/lib/api';
import type { BeatFiles } from '../../src/lib/beatNative/persist';
import { createBeatAiClient } from '../../src/lib/beatAi/client';
import { placementIds } from '../../src/lib/beatAi/shared';
import type { AiDoc, Asset, Pending, MagicPending, Quote } from '../../src/lib/beatAi/types';
export const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const owner = id(1), beatId = id(2);
export const doc = () => createBeat({ id: beatId }) as AiDoc;
export const quote: Quote = { quote_id: id(3), total_credits: 37, balance: 100, balance_after: 63, affordable: true, expires_at: '2099-01-01T00:00:00.000Z' };
export const row = (): Pending => ({ owner, beatId, op: 'generate', quoteId: quote.quote_id, key: `beat-ai.${id(4)}`, quote, source: null, prompt: 'Keys', state: 'pending', createdAt: 1, submitPath: '/music/generations', placementIds: placementIds(`beat-ai.${id(4)}`), placement: { afterTrackId: null, sourceTrackId: null, start: 0, length: 7680, phaseSec: 0, cycle: { start: 0, end: 7680 } } });
export const magicRow = (): MagicPending => ({ owner, beatId, quoteId: quote.quote_id, key: `magic.${id(4)}`, quote, prompt: 'Keys', bars: 4, bpm: 120, createdAt: 1 });
export const asset: Asset = { source: 'song', ref: { songId: id(5), versionId: id(6), jobId: id(7) }, name: 'Keys A', bpm: null, durationSec: 4, sourceChannels: 2, encodedBytes: 1000 };
export function files() {
    const data = new Map<string, string>();
    const port: BeatFiles = { read: jest.fn(async name => data.get(name) ?? null), write: jest.fn(async (name, value) => { data.set(name, value); }), remove: jest.fn(async name => { data.delete(name); }), list: jest.fn(async () => [...data.keys()]) };
    return { data, port };
}
export function client() {
    const request = jest.fn();
    const api = { request } as unknown as ApiClient;
    return { request, api, client: createBeatAiClient(api, owner) };
}
export function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { resolve, promise }; }

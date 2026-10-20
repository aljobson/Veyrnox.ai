import { libraryChoices, toSourceAssets } from '../src/lib/librarySource';
import { mediaApi, type CatalogModel, type Job } from '../src/lib/media';
import { SLOT_ORDER } from '../src/lib/sources';

jest.mock('../src/lib/aiConsentStore', () => ({ aiConsent: { ensure: async () => undefined, hasAgreed: async () => true } }));

const model = (id: string, modality: string): CatalogModel => ({ id, name: `Name ${id}`, modality, credits: 1, gated: false, durations: [], capabilities: null });
const models = [model('img', 'text-to-image'), model('vid', 'text-to-video'), model('aud', 'text-to-speech')];
const job = (over: Partial<Job> = {}): Job => ({ job_id: 'j1', state: 'succeeded', credits: 1, model_id: 'img', created_at: '2026-10-01T00:00:00Z', has_asset: true, ...over });
const NOW = Date.parse('2026-10-19T00:00:00Z');

describe('Library creations offered as a file', () => {
    test('only finished, stored creations of the kind the slot needs', () => {
        const jobs = [job(), job({ job_id: 'v', model_id: 'vid' }), job({ job_id: 'f', state: 'failed' }), job({ job_id: 'n', has_asset: false }), job({ job_id: 'r', state: 'running' })];
        expect(libraryChoices(jobs, models, 'image', NOW).map((c) => c.jobId)).toEqual(['j1']);
        expect(libraryChoices(jobs, models, 'video', NOW).map((c) => c.jobId)).toEqual(['v']);
        expect(libraryChoices(jobs, models, 'audio', NOW)).toEqual([]);
    });
    test('held, expired and unknown-model creations are not offered', () => {
        expect(libraryChoices([job({ held: true })], models, 'image', NOW)).toEqual([]);
        expect(libraryChoices([job({ asset_expires_at: '2026-10-01T00:00:00Z' })], models, 'image', NOW)).toEqual([]);
        expect(libraryChoices([job({ model_id: 'gone' })], models, 'image', NOW)).toEqual([]);
    });
    test('a future or unknown expiry is offered, and the name is the label else the model', () => {
        expect(libraryChoices([job({ asset_expires_at: '2027-01-01T00:00:00Z', label: 'My cat' })], models, 'image', NOW)[0].name).toBe('My cat');
        expect(libraryChoices([job({ asset_expires_at: null })], models, 'image', NOW)[0].name).toBe('Name img');
    });
    test('slots are listed in the fixed order', () => {
        expect(toSourceAssets({ audio: 'a', image: 'i' }, SLOT_ORDER)).toEqual([{ assetId: 'i', slot: 'image' }, { assetId: 'a', slot: 'audio' }]);
        expect(toSourceAssets({}, SLOT_ORDER)).toEqual([]);
    });
});

describe('request with a Library file', () => {
    const send = async (r: Record<string, unknown>) => {
        const request = jest.fn().mockResolvedValue({ job_id: 'j' });
        await mediaApi({ request } as never).createGeneration({ modelId: 'm', prompt: 'x', durationSeconds: null, confirmedCredits: 2, idempotencyKey: 'k', ...r } as never);
        return JSON.parse(request.mock.calls[0][1].body);
    };
    test('sends source_assets with consent and no source_keys', async () => {
        const body = await send({ assets: [{ assetId: 'abc', slot: 'image' }] });
        expect(body.source_assets).toEqual([{ asset_id: 'abc', slot: 'image' }]);
        expect(body.source_keys).toBeUndefined();
        expect(body.consent).toBe(true);
    });
    test('an upload and a Library file can be sent together', async () => {
        const body = await send({ sources: [{ key: 'k1', slot: 'image' }], assets: [{ assetId: 'abc', slot: 'audio' }] });
        expect(body.source_keys).toEqual([{ key: 'k1', slot: 'image' }]);
        expect(body.source_assets).toHaveLength(1);
        expect(body.consent).toBe(true);
    });
    test('nothing about files is sent when none are used', async () => {
        const body = await send({});
        expect(body.source_assets).toBeUndefined();
        expect(body.consent).toBeUndefined();
    });
});

import { ApiError, type ApiClient } from '../src/lib/api';
import { faceFilters, faceInputs, faceRequest, comparisonUri, faceFilterMessage, faceFilterUploadMessage } from '../src/lib/faceFilters';
import { createGenerationSubmit, generationMessage } from '../src/lib/generationSubmit';
import { mediaApi, type CatalogModel } from '../src/lib/media';
import strings from '../src/lib/i18n/messages/en/faceFilters';

jest.mock('expo-crypto', () => { let next = 0; return { randomUUID: () => `test-idempotency-${++next}` }; });
jest.mock('../src/lib/aiConsentStore', () => ({ aiConsent: { ensure: async () => undefined, hasAgreed: async () => true } }));
const model = (id = 'face-retouch', inputs: Record<string, unknown> = {}): CatalogModel => ({ id, name: id, modality: 'image-to-image', credits: 17, gated: false, durations: [], capabilities: { inputs, media: { image: { required: true } } } });
const request = () => faceRequest(model(), 'uploads/photo', '', {}, true);

test('only currently returned open filters, including relight, are listed', () => {
    expect(faceFilters([])).toEqual([]);
    expect(faceFilters([model(), model('other'), { ...model('face-relight'), gated: true }]).map(m => m.id)).toEqual(['face-retouch']);
    expect(faceFilters([model('face-relight', { prompt: { type: 'string' } })])).toHaveLength(1);
});
test('price is exactly the catalog price; relight requires words', () => {
    expect(request().confirmedCredits).toBe(17);
    expect(() => faceRequest(model('face-relight'), 'uploads/photo', '', {}, true)).toThrow();
});
test('stored AI-sharing agreement alone cannot authorize a filter run', async () => {
    expect(() => faceRequest(model(), 'uploads/photo', '', {}, false)).toThrow('api_consent_required');
    const send = jest.fn();
    await expect(mediaApi({ request: send } as unknown as ApiClient).createGeneration({ ...request(), sourceRights: false, idempotencyKey: 'test-run' })).rejects.toMatchObject({ code: 'consent_required' });
    expect(send).not.toHaveBeenCalled();
});
test('selectors intersect capability bounds and server allowlist; counts never leave', () => {
    const age = model('face-age', { target_age: { type: 'int', min: 18, max: 100 }, preserve_identity: { type: 'bool' }, num_images: {}, num_frames: {} });
    expect(faceInputs(age, { target_age: 30, preserve_identity: true, num_images: 9, num_frames: 8 })).toEqual({ target_age: 30, preserve_identity: true });
    expect(() => faceInputs(age, { target_age: 17 })).toThrow();
    expect(() => faceInputs(age, { target_age: 101 })).toThrow();
    const makeup = model('face-makeup', { makeup_style: { type: 'enum', values: ['natural', 'glamorous'] }, intensity: { type: 'enum', values: ['light', 'medium'] } });
    expect(faceInputs(makeup, { makeup_style: 'natural', intensity: 'medium', target_age: 30 })).toEqual({ makeup_style: 'natural', intensity: 'medium' });
    expect(() => faceInputs(makeup, { makeup_style: 'invented' })).toThrow();
});
test('shared lifecycle retains keys after an ambiguous failure, clears on success, changes on edit', async () => {
    const submit = createGenerationSubmit();
    const send = jest.fn().mockRejectedValueOnce(new ApiError(0, 'network')).mockResolvedValue({ job_id: 'job' });
    const api = { request: send } as unknown as ApiClient;
    await expect(submit.run(api, request())).rejects.toThrow();
    await submit.run(api, request());
    const bodies = send.mock.calls.map(([, init]) => JSON.parse(init.body));
    expect(bodies[0].idempotency_key).toBe(bodies[1].idempotency_key);
    expect(bodies[1]).toMatchObject({ consent: true, confirmed_credits: 17 });
    await submit.run(api, request());
    expect(JSON.parse(send.mock.calls[2][1].body).idempotency_key).not.toBe(bodies[0].idempotency_key);
    send.mockRejectedValueOnce(new ApiError(0, 'network'));
    await expect(submit.run(api, request())).rejects.toThrow();
    await submit.run(api, { ...request(), prompt: 'changed' });
    expect(JSON.parse(send.mock.calls[3][1].body).idempotency_key).not.toBe(JSON.parse(send.mock.calls[4][1].body).idempotency_key);
});
test.each([
    ['consent_required', 'Please try again.'],
    ['upload_admission_unavailable', 'That could not start. You were not charged.'],
    ['provider_moderation', 'That could not start. You were not charged.'],
    ['provider_input_rejected', 'That could not start. You were not charged.'],
    ['provider_submit_failed', 'That could not start. You were not charged.'],
])('Create preserves its exact old message for %s', (code, message) => {
    expect(generationMessage(new ApiError(400, code))).toBe(message);
});
test.each([
    ['consent_required', 'Confirm your rights to this photo for this run.'],
    ['upload_admission_unavailable', 'Uploads are paused while safety checks are set up. Nothing was charged.'],
    ['insufficient_credits', 'Not enough credits for this.'],
    ['provider_moderation', 'The provider could not accept this photo or request. Your credits were refunded.'],
    ['provider_input_rejected', 'The provider could not accept this photo or request. Your credits were refunded.'],
    ['provider_submit_failed', 'The provider could not accept this photo or request. Your credits were refunded.'],
    ['rate_limited', 'Too many requests. Wait a moment.'],
])('Face filters shows the exact message for %s', (code, message) => {
    expect(faceFilterMessage(new ApiError(400, code))).toBe(message);
});
test.each([
    ['upload_too_large', 'the photo is over 20 MB'],
    ['upload_type_not_allowed', 'use a JPEG, PNG or WebP image'],
    ['source_not_found', 'the uploaded photo expired; choose it again'],
    ['upload_type_mismatch', 'the file contents do not match its image type'],
    ['upload_new_server_reason', 'upload_new_server_reason'],
])('upload rejection %s uses plain words or the unknown-code fallback', (code, reason) => {
    expect(faceFilterUploadMessage(new ApiError(400, code))).toBe(`The server rejected the photo: ${reason}. Nothing was charged.`);
});
test('accessible comparison toggles the local original without uploading again', () => {
    expect(comparisonUri('before', 'file:///local-photo', 'https://example.invalid/result')).toBe('file:///local-photo');
    expect(comparisonUri('after', 'file:///local-photo', 'https://example.invalid/result')).toBe('https://example.invalid/result');
});

declare const require: (id: string) => any;
declare const __dirname: string;
const fs = require('fs');
const path = require('path');
const read = (p: string) => fs.readFileSync(path.resolve(__dirname, p), 'utf8') as string;
test('rights wording matches binding source and web statement; version belongs to server', () => {
    const binding = read('../../../lib/i18n/messages/legal/en/binding.mjs');
    const text = JSON.parse(binding.match(/"sourceRights": (".*"),/)![1]);
    expect(strings['faceFilters.rights']).toBe(text.replace('{policy}', 'Acceptable Use'));
    expect(read('../../../app/veyrnox/_components/SourceRightsConfirmation.jsx')).toContain('id="sourceRights"');
    expect(read('../../../app/api/v1/generations/route.js')).toContain("RIGHTS_ATTESTATION_VERSION = 'aup-2026-09-26'");
});
test('both front doors use shared submission; result uses existing poll and output helpers', () => {
    for (const p of ['../src/app/(app)/create/[modelId].tsx', '../src/components/FaceFiltersFlow.tsx']) {
        const source = read(p);
        expect(source).toContain('createGenerationSubmit');
        expect(source).not.toContain('.createGeneration(');
        expect(source).not.toContain("'/api/v1/generations'");
    }
    const result = read('../src/components/FaceFilterResult.tsx');
    expect(result).toContain('waitForJob');
    expect(result).toContain('shareOutput');
    expect(result).toContain('saveOutput');
    expect(result).toContain('faceFilterMessage');
    expect(result).toContain('faceFilters.openLibrary');
    expect(strings['faceFilters.openLibrary']).toBe('Open in Library');
    expect(read('../src/app/(app)/create/[modelId].tsx')).not.toContain('faceFilterMessage');
});

test('partial batches replay the same keys and per-image seeds through the shared client', async () => {
    const lifecycle = createGenerationSubmit();
    const send = jest.fn().mockResolvedValueOnce({ job_id: 'first' }).mockRejectedValueOnce(new ApiError(0, 'network')).mockResolvedValue({ job_id: 'first' });
    const api = { request: send } as unknown as ApiClient;
    const batch = { ...request(), extraInputs: { seed: 4 } };
    const progress = jest.fn();
    await expect(lifecycle.run(api, batch, 2, progress)).rejects.toThrow();
    expect(progress).toHaveBeenCalledWith(1);
    await lifecycle.run(api, batch, 2);
    const bodies = send.mock.calls.map(([, init]) => JSON.parse(init.body));
    expect(bodies.map(b => b.inputs.seed)).toEqual([4, 5, 4, 5]);
    expect(bodies[0].idempotency_key).toBe(bodies[2].idempotency_key);
    expect(bodies[1].idempotency_key).toBe(bodies[3].idempotency_key);
});

test('overlapping taps cannot start a second generation', async () => {
    const lifecycle = createGenerationSubmit();
    let finish!: (value: { job_id: string }) => void;
    const send = jest.fn(() => new Promise(resolve => { finish = resolve; }));
    const api = { request: send } as unknown as ApiClient;
    const first = lifecycle.run(api, request());
    await expect(lifecycle.run(api, request())).rejects.toMatchObject({ code: 'submission_in_progress' });
    for (let i = 0; i < 30; i++) await Promise.resolve();
    expect(send).toHaveBeenCalledTimes(1);
    finish({ job_id: 'one' });
    await first;
});


test('the owner-bound client shares AuthProvider session-loss and stream options', () => {
    const screen = read('../src/app/(app)/face-filters.tsx');
    const auth = read('../src/auth/AuthProvider.tsx');
    expect(screen).toContain('onSessionLost,');
    expect(screen).not.toContain('signOut');
    expect(screen).toContain('getCacheUser() !== owner');
    expect(auth).toContain('const onSessionLost = useCallback(() => void drop(), [drop])');
    for (const source of [screen, auth]) {
        expect(source).toContain('streamFetch: expoFetch as unknown as typeof fetch');
        expect(source).toContain('beforeSend: aiConsent.ensure');
    }
});

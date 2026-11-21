import { initialRenderForm, renderFormError, renderInput, parseRender, RENDER_OPERATIONS, stepRenderValue } from '../src/lib/music/renderForm';
import { isRenderResult } from '../src/lib/music/validateRender';
import { renderSong } from '../src/lib/music/renderClient';
import type { ApiClient } from '../src/lib/api';
import { VERSION_ID, SONG_ID } from './fixtures/musicActions';
import { renderCreated, renderCommitReplay, renderEarlyReplay } from './fixtures/musicRender';
const form = initialRenderForm;
test.each([renderCreated, renderCommitReplay, renderEarlyReplay])('accepts first commit and both replay shapes: %j', value => expect(isRenderResult(value)).toBe(true));
test.each([
    null, {}, { ...renderCreated, version_id: 'no' }, { ...renderCreated, version_number: 0 },
    { ...renderCreated, version_number: 1.5 }, { ...renderCreated, render_state: 'preview_only' },
    { ...renderCreated, operation: 'crop' }, { ...renderCreated, format: 'mp3' },
    { ...renderCreated, duration_seconds: NaN }, { ...renderCreated, duration_seconds: 0 },
    { ...renderEarlyReplay, idempotent: false }, { ...renderEarlyReplay, format: 'wav' },
    { ...renderEarlyReplay, duration_seconds: 12 }, { ...renderEarlyReplay, idempotent: 'true' },
])('rejects malformed response %j', v => expect(isRenderResult(v)).toBe(false));
test.each(RENDER_OPERATIONS)('%s produces the exact real server parser shape', operation => {
    const input = renderInput({ ...form, operation }, VERSION_ID);
    expect(parseRender({ ...input, idempotency_key: 'render.fixed' }).ok).toBe(true);
    expect(parseRender({ ...input, idempotency_key: 'render.fixed', extra: 1 }).ok).toBe(false);
});
test.each([
    ['fade', { fadeIn: 0, fadeOut: 0 }, false], ['fade', { fadeIn: 0, fadeOut: 0.5 }, true],
    ['fade', { fadeIn: 30, fadeOut: 30 }, true], ['fade', { fadeIn: 30.5 }, false],
    ['fade', { fadeOut: -0.5 }, false], ['fade', { fadeIn: NaN }, false], ['fade', { fadeOut: Infinity }, false],
    ['speed', { speed: 0.5 }, true], ['speed', { speed: 2 }, true], ['speed', { speed: 1 }, false],
    ['speed', { speed: 0.45 }, false], ['speed', { speed: 2.05 }, false], ['speed', { speed: NaN }, false],
    ['reorder', { split: 1 }, true], ['reorder', { split: 86399 }, true], ['reorder', { split: 86400 }, false],
    ['reorder', { split: 0.5 }, false], ['reorder', { split: Infinity }, false],
    ['remaster', { peak: -3 }, true], ['remaster', { peak: -2 }, true], ['remaster', { peak: -1 }, true],
    ['remaster', { peak: -4 }, false], ['remaster', { peak: 0 }, false], ['remaster', { peak: -1.5 }, false],
    ['reverse', {}, true],
] as const)('%s %j matches real server boundaries (%s)', (operation, patch, valid) => {
    const f = { ...form, operation, ...patch };
    expect(parseRender({ ...renderInput(f, VERSION_ID), idempotency_key: 'render.fixed' }).ok).toBe(valid);
    expect(renderFormError(f, VERSION_ID, 86400) === null).toBe(valid);
});
test('duration is required only for fade/reorder; duration boundaries are inclusive', () => {
    for (const operation of RENDER_OPERATIONS) expect(renderFormError({ ...form, operation }, VERSION_ID, null))
        .toBe(['fade', 'reorder'].includes(operation) ? 'duration_required' : null);
    expect(renderFormError(form, VERSION_ID, 2)).toBeNull();
    expect(renderFormError(form, VERSION_ID, 1.99)).toBe('fade_range_invalid');
    expect(renderFormError({ ...form, operation: 'reorder' }, VERSION_ID, 2)).toBeNull();
    expect(renderFormError({ ...form, operation: 'reorder' }, VERSION_ID, 1.99)).toBe('reorder_range_invalid');
});
test('request IDs, key and section order are validated', () => {
    const input = { ...renderInput({ ...form, operation: 'reorder' }, VERSION_ID), idempotency_key: 'render.fixed' };
    for (const patch of [{ version_id: 'bad' }, { idempotency_key: 'short' }, { order: [1, 2] }, { order: [2, 1, 3] }])
        expect(parseRender({ ...input, ...patch }).ok).toBe(false);
});
test('integer tick controls reach boundaries without drift', () => {
    let speed = 0.5;
    for (let i = 0; i < 30; i++) speed = stepRenderValue(speed, 0.05, 1, 0.5, 2);
    expect(speed).toBe(2); expect(stepRenderValue(speed, 0.05, 1, 0.5, 2)).toBe(2);
    expect(stepRenderValue(1, 0.5, 1, 1, 1.9)).toBe(1.5);
});
test('client rejects an operation mismatch and does not send invalid parameters', async () => {
    const request = jest.fn().mockResolvedValue({ ...renderCreated, operation: 'reverse' });
    const api = { request } as unknown as ApiClient;
    await expect(renderSong(api, SONG_ID, renderInput(form, VERSION_ID), 'render.fixed')).rejects.toMatchObject({ code: 'bad_response' });
    request.mockClear();
    await expect(renderSong(api, SONG_ID, renderInput({ ...form, fadeIn: -1 }, VERSION_ID), 'render.fixed')).rejects.toMatchObject({ code: 'fade_range_invalid' });
    expect(request).not.toHaveBeenCalled();
});

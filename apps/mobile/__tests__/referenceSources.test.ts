import { slotsFor, checkPicked, pickedProblem, type PickedFile } from '../src/lib/sources';
import { chooseLocale, t, ACTIVE_LOCALES } from '../src/lib/i18n';
import { generationMessage } from '../src/lib/generationSubmit';
import { ApiError } from '../src/lib/api';
import type { CatalogModel } from '../src/lib/media';

const limits = { minSeconds: 3, maxSeconds: 10, minSide: 720, maxSide: 2160 };
const model: CatalogModel = { id: 'kling-o1-reference', name: 'Kling O1 · Reference', modality: 'video-to-video', credits: 47, gated: false, durations: [5, 10], capabilities: {
    media: { video: { required: true, ...limits }, image: { required: true, maxFiles: 2, label: 'Reference pictures' } },
} };
const clip: PickedFile = { uri: 'file:///video.mp4', mimeType: 'video/mp4', size: 1000, durationSeconds: 5, width: 1280, height: 720 };
afterEach(() => chooseLocale('en'));

test('video uploads still accept only MP4', () => {
    expect(checkPicked('video', clip, limits)).toEqual({ ok: true, contentType: 'video/mp4' });
    for (const mimeType of ['video/quicktime', 'video/webm']) {
        expect(checkPicked('video', { ...clip, mimeType }, limits)).toEqual({ ok: false, error: 'type' });
    }
});

test('public source bounds survive mobile slot mapping and legacy slots stay unchanged', () => {
    expect(slotsFor(model)).toEqual([
        { slot: 'image', kind: 'image', required: true, maxFiles: 2, label: 'Reference pictures' },
        { slot: 'video', kind: 'video', required: true, maxFiles: 1, label: 'Video', ...limits },
    ]);
    expect(slotsFor({ ...model, capabilities: { media: { audio: { maxSeconds: 40 } } } })[0]).toMatchObject({ maxSeconds: 40 });
    expect(slotsFor({ ...model, capabilities: { media: { audio: { maxSeconds: 40 } } } })[0]).not.toHaveProperty('minSeconds');
});

test.each([
    [{ durationSeconds: 2 }, 'too_short'],
    [{ durationSeconds: 11 }, 'too_long'],
    [{ width: 640, height: 360 }, 'resolution'],
    [{ width: 3000 }, 'resolution'],
    [{ height: 3000 }, 'resolution'],
])('known out-of-range metadata %j is rejected before upload', (override, error) => {
    expect(checkPicked('video', { ...clip, ...override }, limits)).toEqual({ ok: false, error });
});

test.each([
    {}, { durationSeconds: 3 }, { durationSeconds: 10 }, { width: 720, height: 2160 }, { width: 2160, height: 720 },
    { durationSeconds: 0 }, { durationSeconds: -1 }, { durationSeconds: undefined }, { durationSeconds: NaN }, { width: undefined, height: undefined },
    { width: 0, height: 0 }, { width: NaN }, { height: undefined },
])('boundary or unknown metadata %j passes to authoritative server inspection', override => {
    expect(checkPicked('video', { ...clip, ...override }, limits)).toEqual({ ok: true, contentType: 'video/mp4' });
});

test('legacy numeric duration checks remain compatible and new bounds are opt-in', () => {
    expect(checkPicked('video', { ...clip, durationSeconds: 2, width: 640, height: 360 }, 10).ok).toBe(true);
    expect(checkPicked('video', { ...clip, durationSeconds: 11 }, 10)).toEqual({ ok: false, error: 'too_long' });
});

test.each(ACTIVE_LOCALES)('%s translates reference and start/end labels, both local checks and server errors', locale => {
    chooseLocale(locale);
    for (const label of ['Reference pictures', 'Start frame', 'End frame']) {
        const slot = slotsFor({ ...model, capabilities: { media: { image: { label } } } })[0];
        expect(slot.label).toBe(t(`label.${label}`));
        expect(slot.label === label).toBe(locale === 'en');
    }
    expect(slotsFor({ ...model, capabilities: { media: { image: { label: 'Custom material' } } } })[0].label).toBe('Custom material');
    for (const [code, key] of [['too_short', 'sourceLimits.tooShort'], ['resolution', 'sourceLimits.resolution']] as const) {
        expect(pickedProblem(code, 'video')).toBe(t(key));
        expect(pickedProblem(code, 'video')).not.toBe(key);
    }
    for (const code of ['source_too_short', 'source_resolution_out_of_range']) {
        expect(generationMessage(new ApiError(400, code))).toBe(t(`app.create.error.${code}`));
        expect(generationMessage(new ApiError(400, code))).not.toBe(t('form.err.default'));
    }
});

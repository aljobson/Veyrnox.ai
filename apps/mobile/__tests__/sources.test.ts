import { checkPicked, missingRequired, requiredNamedSlots, slotsFor, toSourceKeys, type PickedFile } from '../src/lib/sources';
import type { CatalogModel } from '../src/lib/media';

const MB = 1024 * 1024;
const model = (media: Record<string, unknown> | undefined, modality = 'image-to-image'): CatalogModel => ({
    id: 'm', name: 'M', modality, credits: 1, gated: false, durations: [5],
    capabilities: media ? { media: media as never, inputs: {} } : null,
});
const file = (over: Partial<PickedFile> = {}): PickedFile => ({ uri: 'file:///a.jpg', mimeType: 'image/jpeg', size: MB, ...over });

describe('slotsFor', () => {
    test('lists declared slots in a stable order with labels and requirement', () => {
        const slots = slotsFor(model({ endImage: { label: 'Last frame' }, audio: { required: true, label: 'Speech', maxSeconds: 60 }, image: { required: true, label: 'Face' } }));
        expect(slots.map((s) => s.slot)).toEqual(['image', 'endImage', 'audio']);
        expect(slots[0]).toMatchObject({ kind: 'image', required: true, label: 'Face' });
        expect(slots[2]).toMatchObject({ kind: 'audio', maxSeconds: 60 });
    });

    test('ignores slot names the server does not know and models with no media', () => {
        expect(slotsFor(model({ mystery: { required: true } }))).toEqual([]);
        expect(slotsFor(model(undefined))).toEqual([]);
    });

    test('guided recipes require only their exact named slots, not another slot of the same kind', () => {
        const slots = requiredNamedSlots(model({ image: { required: true }, endImage: { required: false }, audio: { required: false } }), ['image', 'audio']);
        expect(slots.map((slot) => slot.slot)).toEqual(['image', 'audio']);
        expect(slots.every((slot) => slot.required)).toBe(true);
    });
});

describe('checkPicked', () => {
    test('accepts allowed types under their cap', () => {
        expect(checkPicked('image', file())).toEqual({ ok: true, contentType: 'image/jpeg' });
        expect(checkPicked('video', file({ mimeType: 'video/mp4', size: 90 * MB }))).toEqual({ ok: true, contentType: 'video/mp4' });
        expect(checkPicked('audio', file({ mimeType: 'audio/mpeg' }))).toEqual({ ok: true, contentType: 'audio/mpeg' });
    });

    test('maps common aliases (jpg, x-wav, wave) to the types the server allows', () => {
        expect(checkPicked('image', file({ mimeType: 'image/jpg' }))).toEqual({ ok: true, contentType: 'image/jpeg' });
        expect(checkPicked('audio', file({ mimeType: 'audio/x-wav' }))).toEqual({ ok: true, contentType: 'audio/wav' });
        expect(checkPicked('audio', file({ mimeType: 'audio/wave' }))).toEqual({ ok: true, contentType: 'audio/wav' });
    });

    test('refuses a type that does not fit the slot or is not allowed', () => {
        expect(checkPicked('image', file({ mimeType: 'video/mp4' }))).toEqual({ ok: false, error: 'type' });
        expect(checkPicked('image', file({ mimeType: 'image/heic' }))).toEqual({ ok: false, error: 'type' });
        expect(checkPicked('audio', file({ mimeType: 'audio/aac' }))).toEqual({ ok: false, error: 'type' });
        expect(checkPicked('video', file({ mimeType: 'video/quicktime' }))).toEqual({ ok: false, error: 'type' });
    });

    test('refuses a file over the cap, an unknown size and an empty file', () => {
        expect(checkPicked('image', file({ size: 21 * MB }))).toEqual({ ok: false, error: 'too_large' });
        expect(checkPicked('video', file({ mimeType: 'video/mp4', size: 101 * MB }))).toEqual({ ok: false, error: 'too_large' });
        expect(checkPicked('image', file({ size: undefined }))).toEqual({ ok: false, error: 'size_unknown' });
        expect(checkPicked('image', file({ size: 0 }))).toEqual({ ok: false, error: 'size_unknown' });
    });

    test('refuses media longer than the slot allows when the length is known', () => {
        expect(checkPicked('audio', file({ mimeType: 'audio/wav', durationSeconds: 61 }), 60)).toEqual({ ok: false, error: 'too_long' });
        expect(checkPicked('audio', file({ mimeType: 'audio/wav', durationSeconds: 60 }), 60)).toEqual({ ok: true, contentType: 'audio/wav' });
        expect(checkPicked('audio', file({ mimeType: 'audio/wav' }), 60)).toEqual({ ok: true, contentType: 'audio/wav' });
    });
});

describe('missingRequired and toSourceKeys', () => {
    const slots = slotsFor(model({ image: { required: true, label: 'Face' }, audio: { required: true, label: 'Speech' }, endImage: { label: 'Last' } }));

    test('names every required slot that has no uploaded file', () => {
        expect(missingRequired(slots, { image: 'uploads/u/1.jpg' })).toEqual(['audio']);
        expect(missingRequired(slots, {})).toEqual(['image', 'audio']);
        expect(missingRequired(slots, { image: 'k1', audio: 'k2' })).toEqual([]);
    });

    test('builds the generation reference list with slot names, skipping empty slots', () => {
        expect(toSourceKeys({ image: 'k1', endImage: undefined, audio: 'k2' })).toEqual([
            { key: 'k1', slot: 'image' },
            { key: 'k2', slot: 'audio' },
        ]);
    });
});

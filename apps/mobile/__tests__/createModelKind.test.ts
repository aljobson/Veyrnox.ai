import { isAudioDriven, isSoundPass, isSpeechModel, missingNeedKey, missingRequiredSlots } from '../src/lib/createModelKind';
import type { CatalogModel } from '../src/lib/media';

const model = (id: string, modality: string, media: NonNullable<CatalogModel['capabilities']>['media'] = {}): CatalogModel => ({ id, name: id, modality, credits: 1, gated: false, durations: [5], capabilities: { inputs: { prompt: {} }, media } });
const avatar = model('kling-avatar-v2', 'image-to-video', { image: { required: true, label: 'Image' }, audio: { required: true, label: 'Audio' } });

describe('create model kinds', () => {
    it('treats a model that needs audio as audio-driven, so the camera panel is hidden', () => {
        expect(isAudioDriven(avatar)).toBe(true);
        expect(isAudioDriven(model('kling', 'text-to-video'))).toBe(false);
        expect(isAudioDriven(model('seed', 'image-to-video', { image: { required: true } }))).toBe(false);
    });
    it('recognises the add-sound tool, so lens words and the "describe the change" hint are not offered for it', () => {
        expect(isSoundPass(model('mmaudio-v2-video', 'video-to-video'))).toBe(true);
        expect(isSoundPass(model('kling', 'text-to-video'))).toBe(false);
        expect(isSoundPass(model('mmaudio-v3', 'video-to-audio'))).toBe(true);
    });
    it('recognises speech models, not music', () => {
        expect(isSpeechModel(model('elevenlabs-tts-turbo', 'text-to-speech'))).toBe(true);
        expect(isSpeechModel(model('ace-step', 'text-to-music'))).toBe(false);
        expect(isSpeechModel(avatar)).toBe(false);
    });
    it('names the required file that is still missing when only the audio is attached', () => {
        expect(missingRequiredSlots(avatar, [{ slot: 'audio' }], false)).toEqual(['Image']);
        expect(missingRequiredSlots(avatar, [{ slot: 'audio' }], true)).toEqual([]);
        expect(missingRequiredSlots(avatar, [], false)).toEqual(['Image', 'Audio']);
    });
    it('names what Generate is waiting for, for every kind of required slot', () => {
        expect(missingNeedKey(avatar, [{ slot: 'image' }], false, false)).toBe('create.needs.audio');
        expect(missingNeedKey(avatar, [{ slot: 'audio' }], false, false)).toBe('create.needs.image');
        expect(missingNeedKey(avatar, [{ slot: 'audio' }], true, false)).toBeNull();
        const clip = model('clip', 'video-to-video', { video: { required: true, label: 'Video' } });
        expect(missingNeedKey(clip, [], false, false)).toBe('create.needs.video');
        expect(missingNeedKey(model('t2i', 'text-to-image'), [], false, true)).toBe('create.needs.prompt');
        expect(missingNeedKey(model('t2i', 'text-to-image'), [], false, false)).toBeNull();
    });
});

import { isAudioDriven, isSpeechModel, missingRequiredSlots } from '../src/lib/createModelKind';
import type { CatalogModel } from '../src/lib/media';

const model = (id: string, modality: string, media: NonNullable<CatalogModel['capabilities']>['media'] = {}): CatalogModel => ({ id, name: id, modality, credits: 1, gated: false, durations: [5], capabilities: { inputs: { prompt: {} }, media } });
const avatar = model('kling-avatar-v2', 'image-to-video', { image: { required: true, label: 'Image' }, audio: { required: true, label: 'Audio' } });

describe('create model kinds', () => {
    it('treats a model that needs audio as audio-driven, so the camera panel is hidden', () => {
        expect(isAudioDriven(avatar)).toBe(true);
        expect(isAudioDriven(model('kling', 'text-to-video'))).toBe(false);
        expect(isAudioDriven(model('seed', 'image-to-video', { image: { required: true } }))).toBe(false);
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
});

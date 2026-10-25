import { consumeCreativeSourceHandoff, readCreativeSourceHandoff, stageCreativeSourceHandoff } from '../src/lib/creativeSourceHandoff';

describe('guided creative source handoff', () => {
    test('moves uploaded and Library sources once without putting keys in navigation', () => {
        const key = stageCreativeSourceHandoff({ recipe: 'talking-avatar', modelId: 'avatar', aspect: '9:16', uploaded: { image: 'private/image-key', audio: 'private/audio-key' }, fromLibrary: {} }, 100);
        expect(key).not.toContain('private');
        expect(readCreativeSourceHandoff(key, 'talking-avatar', 'avatar', 200)).toMatchObject({ uploaded: { image: 'private/image-key', audio: 'private/audio-key' } });
        expect(readCreativeSourceHandoff(key, 'talking-avatar', 'avatar', 200)).not.toBeNull();
        expect(consumeCreativeSourceHandoff(key, 'talking-avatar', 'avatar', 200)).toMatchObject({ aspect: '9:16', uploaded: { image: 'private/image-key', audio: 'private/audio-key' } });
        expect(consumeCreativeSourceHandoff(key, 'talking-avatar', 'avatar', 200)).toBeNull();
    });

    test('rejects mismatched and expired handoffs', () => {
        const mismatch = stageCreativeSourceHandoff({ recipe: 'video-dubbing', modelId: 'sync', aspect: '9:16', uploaded: { video: 'v' }, fromLibrary: { audio: 'job' } }, 100);
        expect(consumeCreativeSourceHandoff(mismatch, 'talking-avatar', 'sync', 200)).toBeNull();
        const expired = stageCreativeSourceHandoff({ recipe: 'video-dubbing', modelId: 'sync', aspect: '9:16', uploaded: { video: 'v' }, fromLibrary: {} }, 100);
        expect(consumeCreativeSourceHandoff(expired, 'video-dubbing', 'sync', 15 * 60 * 1000 + 101)).toBeNull();
    });
});

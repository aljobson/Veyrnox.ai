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

    test('carries the source-rights tick only when the handing screen recorded it', () => {
        const attach = stageCreativeSourceHandoff({ recipe: 'attach', modelId: 'm', uploaded: { image: 'k' }, fromLibrary: {} }, 100);
        expect(readCreativeSourceHandoff(attach, 'attach', 'm', 200)?.rightsConfirmed).toBe(false);
        const ticked = stageCreativeSourceHandoff({ recipe: 'talking-avatar', modelId: 'm', uploaded: {}, fromLibrary: {}, rightsConfirmed: true }, 100);
        expect(readCreativeSourceHandoff(ticked, 'talking-avatar', 'm', 200)?.rightsConfirmed).toBe(true);
    });

    test('rejects mismatched and expired handoffs', () => {
        const mismatch = stageCreativeSourceHandoff({ recipe: 'video-dubbing', modelId: 'sync', aspect: '9:16', uploaded: { video: 'v' }, fromLibrary: { audio: 'job' } }, 100);
        expect(consumeCreativeSourceHandoff(mismatch, 'talking-avatar', 'sync', 200)).toBeNull();
        const expired = stageCreativeSourceHandoff({ recipe: 'video-dubbing', modelId: 'sync', aspect: '9:16', uploaded: { video: 'v' }, fromLibrary: {} }, 100);
        expect(consumeCreativeSourceHandoff(expired, 'video-dubbing', 'sync', 15 * 60 * 1000 + 101)).toBeNull();
    });
});

test('16:9, followup and independent picks survive stage and read', () => {
    const picks = { character_type: 'Human' };
    const token = stageCreativeSourceHandoff({ recipe: 'faceless-reel', modelId: 'wan-2.5-kie', aspect: '16:9', followup: 'generated-sound', picks, uploaded: {}, fromLibrary: {} });
    picks.character_type = 'changed';
    const first = readCreativeSourceHandoff(token, 'faceless-reel', 'wan-2.5-kie')!;
    expect(first).toMatchObject({ aspect: '16:9', followup: 'generated-sound', picks: { character_type: 'Human' }, rightsConfirmed: false });
    (first.picks as Record<string, string>).character_type = 'changed again';
    expect(readCreativeSourceHandoff(token, 'faceless-reel', 'wan-2.5-kie')?.picks).toEqual({ character_type: 'Human' });
});

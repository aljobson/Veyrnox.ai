import { audioAsPreset } from '../src/lib/exploreTemplates';
test('an audio template in Explore uses its artwork as the poster', () => {
    const a = { id: 'x', name: 'X', category: 'MUSIC', modelId: 'm', prompt: 'p', previewUrl: 'https://veyrnox.ai/music-licensed/x.jpg', previewAudioUrl: null };
    expect(audioAsPreset(a, new Map()).posterUrl).toBe('https://veyrnox.ai/music-licensed/x.jpg');
    expect(audioAsPreset({ ...a, previewUrl: null }, new Map()).posterUrl).toBeNull();
});

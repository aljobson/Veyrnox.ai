import { audioCategoriesOf, audioTemplatesIn, parseAudioTemplates } from '../src/lib/audioTemplates';
const body = { templates: [
    { id: 'audio-a', name: 'A', category: 'MUSIC', modelId: 'm', prompt: 'p' },
    { id: 'audio-b', name: 'B', category: 'SOUND FX', modelId: 'm', prompt: 'p', negativePrompt: 'music' },
    { id: 'audio-c', name: 'C', category: 'MUSIC', modelId: 'm' },
] };
test('parse keeps well-formed audio templates and drops the rest', () => {
    const list = parseAudioTemplates(body);
    expect(list.map(t => t.id)).toEqual(['audio-a', 'audio-b']);
    expect(list[1].negativePrompt).toBe('music');
    expect(parseAudioTemplates(null)).toEqual([]);
});
test('categories keep first-seen order and the ALL chip returns every template', () => {
    const list = parseAudioTemplates(body);
    expect(audioCategoriesOf(list)).toEqual(['MUSIC', 'SOUND FX']);
    expect(audioTemplatesIn(list, 'ALL')).toHaveLength(2);
    expect(audioTemplatesIn(list, 'SOUND FX').map(t => t.id)).toEqual(['audio-b']);
});
test('parse keeps the artwork as an absolute address and refuses other schemes', () => {
    const list = parseAudioTemplates({ templates: [
        { id: 'a', name: 'A', category: 'MUSIC', modelId: 'm', prompt: 'p', previewImage: '/music-licensed/a.svg', previewAudio: '/music-licensed/a.mp3' },
        { id: 'b', name: 'B', category: 'MUSIC', modelId: 'm', prompt: 'p', previewImage: 'javascript:alert(1)' },
        { id: 'c', name: 'C', category: 'MUSIC', modelId: 'm', prompt: 'p' },
    ] }, 'https://veyrnox.ai');
    expect(list.map(t => t.previewUrl)).toEqual(['https://veyrnox.ai/music-licensed/a.svg', null, null]);
    expect(list.map(t => t.previewAudioUrl)).toEqual(['https://veyrnox.ai/music-licensed/a.mp3', null, null]);
});
test('parse keeps the track credit line the licence asks for', () => {
    const list = parseAudioTemplates({ templates: [
        { id: 'a', name: 'A', category: 'MUSIC', modelId: 'm', prompt: 'p', previewAttribution: 'Music by cdk — CC BY 3.0' },
        { id: 'b', name: 'B', category: 'MUSIC', modelId: 'm', prompt: 'p', previewAttribution: 7 },
    ] });
    expect(list.map(t => t.attribution)).toEqual(['Music by cdk — CC BY 3.0', undefined]);
});

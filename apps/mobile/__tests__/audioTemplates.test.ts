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

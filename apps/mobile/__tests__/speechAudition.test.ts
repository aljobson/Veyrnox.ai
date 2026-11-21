import { buildAuditionRequest, auditionBatchNote, validateAudition } from '../src/lib/speech/audition';
import { DEFAULT_TTS_SETTINGS, TTS_VOICES, MIN_AUDITION_VOICES, MAX_AUDITION_VOICES, normalizeAuditionVoices, toggleAuditionVoice, auditionCost, voiceAuditionScript } from '../src/lib/speech/shared';
import { generationSignature } from '../src/lib/generationSubmit';
import { setLocaleFromDevice, plural } from '../src/lib/i18n';
import type { CatalogModel } from '../src/lib/media';
const model: CatalogModel = { id: 'minimax-speech-2.6-hd', name: 'Speech', modality: 'text-to-speech', credits: 6, durations: [], gated: false, capabilities: { inputs: { prompt: {} } } };
const voices = TTS_VOICES.slice(0, 4).map(voice => voice.id);
afterEach(() => setLocaleFromDevice(['en']));
test('shared board normalization, toggle limits and price stay pinned to web behavior', () => {
    expect([MIN_AUDITION_VOICES, MAX_AUDITION_VOICES]).toEqual([2, 3]);
    expect(normalizeAuditionVoices(null)).toEqual([]);
    expect(normalizeAuditionVoices(['unknown', voices[0], voices[0], ...voices])).toEqual(voices.slice(0, 3));
    let board: string[] = [];
    for (const voice of voices) board = toggleAuditionVoice(board, voice);
    expect(board).toEqual(voices.slice(0, 3));
    expect(toggleAuditionVoice(board, 'unknown')).toEqual(board);
    expect(toggleAuditionVoice(board, voices[1])).toEqual([voices[0], voices[2]]);
    expect(auditionCost(6, board)).toBe(18);
    expect(auditionCost(6, [voices[0], voices[0], 'unknown'])).toBe(6);
    expect(auditionCost(NaN, board)).toBe(0);
    expect(voiceAuditionScript()).not.toBe('');
    expect(voiceAuditionScript().length).toBeLessThanOrEqual(500);
});
test.each([[], [voices[0]], [voices[0], voices[0]], [voices[0], 'unknown'], voices].map(ids => ({ ids })))('invalid voice selection %p is rejected', ({ ids }) => {
    expect(validateAudition('Hello', DEFAULT_TTS_SETTINGS, ids)).toBe('speech.audition.invalidVoices');
    expect(() => buildAuditionRequest('Hello', DEFAULT_TTS_SETTINGS, ids, model)).toThrow('speech.audition.invalidVoices');
});
test('the inactive single-voice selection cannot change audition identity or inputs', () => {
    const board = voices.slice(0, 2);
    const first = buildAuditionRequest('Hello', DEFAULT_TTS_SETTINGS, board, model);
    const next = buildAuditionRequest('Hello', { ...DEFAULT_TTS_SETTINGS, voice: voices[2] }, board, model);
    expect(generationSignature(next, 2)).toBe(generationSignature(first, 2));
    expect(next.inputsByIndex).toEqual(first.inputsByIndex);
    expect(validateAudition('Hello', DEFAULT_TTS_SETTINGS, board)).toBeNull();
});
test.each(['', ' ', 'x'.repeat(501)])('script validation is shared: %p', script => {
    expect(() => buildAuditionRequest(script, DEFAULT_TTS_SETTINGS, voices.slice(0, 2), model)).toThrow();
});
test('settings validation, trimmed text and per-voice identity', () => {
    expect(() => buildAuditionRequest('Hello', { ...DEFAULT_TTS_SETTINGS, pitch: 0.5 }, voices.slice(0, 2), model)).toThrow('speech.invalidSettings');
    const r = buildAuditionRequest(' Hello ', DEFAULT_TTS_SETTINGS, voices.slice(0, 2), model);
    expect(r.prompt).toBe('Hello');
    expect(r.inputsByIndex?.map(item => item.tts_voice)).toEqual(voices.slice(0, 2));
    expect(generationSignature(r, 2)).not.toBe(generationSignature({ ...r, inputsByIndex: [...r.inputsByIndex!].reverse() }, 2));
});
test.each(['en', 'es', 'ar', 'de', 'fr', 'hi', 'ja', 'ko', 'pt', 'ru', 'zh'])('%s partial batch notices use translated plural forms', locale => {
    setLocaleFromDevice([locale]);
    expect(auditionBatchNote(1, voices.slice(0, 3), 1)).toBe(plural('speech.audition.stopped', 3, { started: 1, next: 2 }));
    expect(auditionBatchNote(1, voices.slice(0, 3), 1, true)).toBe(plural('speech.audition.uncertain', 3, { started: 1, next: 2 }));
    expect(auditionBatchNote(0, [], 0)).toBe('');
});

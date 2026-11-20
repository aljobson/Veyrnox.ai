import { buildSpeechRequest, insertCue, stepSpeechValue, validateSpeech } from '../src/lib/speech/studio';
import { DEFAULT_TTS_SETTINGS, TTS_INPUT_RULES, TTS_VOICES, TTS_LANGUAGES, TTS_EMOTIONS, TTS_INTERJECTIONS, TTS_PAUSES, pauseCue, ttsGenerationInputs } from '../src/lib/speech/shared';
import { speechModel, SPEECH_MODEL_ID } from '../src/lib/speech/model';
import type { CatalogModel } from '../src/lib/media';
// @ts-ignore server JS contract, independent of the mobile seam
import { TTS_VOICE_IDS } from '../../../lib/speechInputs.js';
export const model: CatalogModel = { id: SPEECH_MODEL_ID, name: 'Speech', modality: 'text-to-speech', credits: 6, durations: [], gated: false, capabilities: { inputs: { prompt: { max: 500 } } } };
function serverAccepts(inputs: Record<string, unknown>) {
    return Object.entries(TTS_INPUT_RULES).every(([key, rule]) => {
        const value = inputs[key];
        return rule.type === 'enum' ? rule.values.includes(value as string)
            : typeof value === 'number' && Number.isFinite(value) && value >= rule.min && value <= rule.max && (rule.type !== 'int' || Number.isInteger(value));
    });
}
test('shared defaults and every exposed choice satisfy the independent server contract', () => {
    expect(serverAccepts(ttsGenerationInputs(DEFAULT_TTS_SETTINGS))).toBe(true);
    expect(TTS_VOICES.map(v => v.id).sort()).toEqual([...TTS_VOICE_IDS].sort());
    for (const voice of TTS_VOICES) expect(serverAccepts(ttsGenerationInputs({ ...DEFAULT_TTS_SETTINGS, voice: voice.id }))).toBe(true);
    for (const language of TTS_LANGUAGES) expect(serverAccepts(ttsGenerationInputs({ ...DEFAULT_TTS_SETTINGS, language }))).toBe(true);
    for (const emotion of TTS_EMOTIONS) expect(serverAccepts(ttsGenerationInputs({ ...DEFAULT_TTS_SETTINGS, emotion }))).toBe(true);
});
test('request is trimmed, catalog priced, flat audio with all six numeric/enum controls', () => {
    expect(buildSpeechRequest('  Hello  ', DEFAULT_TTS_SETTINGS, model)).toEqual({ modelId: SPEECH_MODEL_ID, prompt: 'Hello', durationSeconds: null,
        confirmedCredits: 6, analyticsKind: 'audio', extraInputs: { tts_voice: 'Wise_Woman', tts_language: 'auto', tts_emotion: 'neutral', tts_speed: 1, tts_volume: 1, tts_pitch: 0 } });
    for (const settings of [{ ...DEFAULT_TTS_SETTINGS, speed: 0.5, volume: 0, pitch: -12 }, { ...DEFAULT_TTS_SETTINGS, speed: 2, volume: 10, pitch: 12 }]) {
        expect(validateSpeech('a'.repeat(500), settings)).toBeNull();
        expect(serverAccepts(buildSpeechRequest('Hello', settings, model).extraInputs!)).toBe(true);
    }
});
test.each(['', '   ', 'x'.repeat(501)])('rejects invalid script length', script => {
    expect(validateSpeech(script, DEFAULT_TTS_SETTINGS)).not.toBeNull();
    expect(() => buildSpeechRequest(script, DEFAULT_TTS_SETTINGS, model)).toThrow();
});
test.each([{ speed: 0.49 }, { speed: 2.1 }, { volume: -0.1 }, { volume: 10.1 }, { pitch: -13 }, { pitch: 13 }, { pitch: 0.1 },
    { speed: NaN }, { volume: Infinity }, { voice: 'unknown' }, { language: 'unknown' }, { emotion: 'unknown' }])('rejects settings %p', patch => {
    expect(validateSpeech('Hello', { ...DEFAULT_TTS_SETTINGS, ...patch })).toBe('speech.invalidSettings');
});
test('steppers clamp and avoid floating point drift; pitch is integral', () => {
    expect(stepSpeechValue('speed', 2, 1)).toBe(2);
    expect(stepSpeechValue('speed', 0.5, -1)).toBe(0.5);
    expect(stepSpeechValue('volume', 1, 1)).toBe(2);
    expect(stepSpeechValue('volume', 2, -1)).toBe(1);
    expect(stepSpeechValue('volume', 0, -1)).toBe(0);
    expect(stepSpeechValue('volume', 10, 1)).toBe(10);
    expect(stepSpeechValue('pitch', -12, -1)).toBe(-12);
    expect(stepSpeechValue('pitch', 12, 1)).toBe(12);
    expect(stepSpeechValue('speed', 0.7, 1)).toBe(0.8);
    expect(stepSpeechValue('pitch', 0, 1)).toBe(1);
});
test.each([...TTS_PAUSES.map(pauseCue), ...TTS_INTERJECTIONS.map(([, cue]) => cue)])('atomic cue %s fits exactly or leaves original unchanged', cue => {
    const script = 'x'.repeat(500 - cue.length - 1);
    expect(insertCue(script, cue)).toEqual({ script: `${script} ${cue}`, tooLong: false });
    expect(insertCue(script + 'x ', cue)).toEqual({ script: script + 'x ', tooLong: true });
    expect(insertCue('  Hi  ', cue)).toEqual({ script: `Hi ${cue}`, tooLong: false });
});
test('catalog studio selection excludes missing, gated, unsupported and invalid prices', () => {
    expect(speechModel([model])).toBe(model);
    expect(speechModel([])).toBeNull();
    for (const patch of [{ gated: true }, { id: 'other' }, { credits: NaN }, { capabilities: null }]) expect(speechModel([{ ...model, ...patch }])).toBeNull();
});

test('the input counter and validation count whitespace toward the native 500-character cap', () => {
    expect(validateSpeech(' ' + 'x'.repeat(499), DEFAULT_TTS_SETTINGS)).toBeNull();
    expect(validateSpeech(' ' + 'x'.repeat(500), DEFAULT_TTS_SETTINGS)).toBe('speech.tooLong');
});

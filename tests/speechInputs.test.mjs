import test from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { validateInputs } from '../lib/generationInputValidation.js';
import { capabilityFor, checkInputs, declaredInputs, shapePayload, publicCapabilities } from '../lib/modelCapabilities.js';
import { TTS_VOICE_IDS, TTS_LANGUAGE_VALUES, TTS_EMOTION_VALUES, DIALOGUE_INPUT_RULES, SPEECH_CONTROL_KEYS } from '../lib/speechInputs.js';
import { DIALOGUE_VOICES, DIALOGUE_VOICE_INPUTS } from '../lib/dialogue.js';
import { TTS_VOICES, TTS_LANGUAGES, TTS_EMOTIONS, DEFAULT_TTS_SETTINGS, ttsGenerationInputs } from '../app/veyrnox/_lib/textToSpeech.js';
import { dialogueCastInputs } from '../app/veyrnox/_lib/dialogueCastMap.js';

const minimax = capabilityFor('fal-ai/minimax/speech-2.6-hd');
const dialogue = capabilityFor('fal-ai/elevenlabs/text-to-dialogue/eleven-v3');
const webInputs = { prompt: 'Hello there', ...ttsGenerationInputs(DEFAULT_TTS_SETTINGS) };

test('server speech lists match the studio choices and all ten control keys', () => {
    assert.equal(TTS_VOICE_IDS.length, 17);
    assert.equal(TTS_LANGUAGE_VALUES.length, 18);
    assert.equal(TTS_EMOTION_VALUES.length, 7);
    assert.deepEqual(TTS_VOICE_IDS, TTS_VOICES.map(voice => voice.id));
    assert.deepEqual(TTS_LANGUAGE_VALUES, TTS_LANGUAGES);
    assert.deepEqual(TTS_EMOTION_VALUES, TTS_EMOTIONS);
    assert.deepEqual(Object.keys(DIALOGUE_INPUT_RULES), DIALOGUE_VOICE_INPUTS);
    for (const rule of Object.values(DIALOGUE_INPUT_RULES)) assert.deepEqual(rule.values, DIALOGUE_VOICES);
    assert.deepEqual(SPEECH_CONTROL_KEYS, [...Object.keys(ttsGenerationInputs()), ...DIALOGUE_VOICE_INPUTS]);
});

test('global and model validation accept the web payload, all choices and numeric boundaries', () => {
    assert.deepEqual(validateInputs(webInputs), { ok: true });
    assert.deepEqual(checkInputs(minimax, webInputs), { ok: true });
    for (const [key, values] of Object.entries({
        tts_voice: TTS_VOICE_IDS, tts_language: TTS_LANGUAGE_VALUES, tts_emotion: TTS_EMOTION_VALUES,
        tts_speed: [0.5, 1.25, 2], tts_volume: [0, 0.5, 10], tts_pitch: [-12, 0, 12],
    })) {
        for (const value of values) {
            const inputs = { prompt: 'hi', [key]: value };
            assert.deepEqual(validateInputs(inputs), { ok: true }, `${key}=${value}`);
            assert.deepEqual(checkInputs(minimax, inputs), { ok: true }, `${key}=${value}`);
        }
    }
    for (const key of DIALOGUE_VOICE_INPUTS) {
        for (const voice of DIALOGUE_VOICES) assert.deepEqual(validateInputs({ [key]: voice }), { ok: true });
    }
    assert.deepEqual(validateInputs({ prompt: 'Ana: Hi', ...dialogueCastInputs([{ voice: 'George' }]) }), { ok: true });
});

test('both gates reject invalid speech values without coercing numeric strings', () => {
    for (const [key, values] of Object.entries({
        tts_voice: ['unknown', null], tts_language: ['unknown'], tts_emotion: ['unknown'],
        tts_speed: [0.49, 2.01, NaN, Infinity, -Infinity, '1', null, true],
        tts_volume: [-1, 10.5, NaN, Infinity, '1', null, false],
        tts_pitch: [-13, 1.5, 13, NaN, Infinity, '1', null],
        dialogue_voice_1: ['unknown'],
    })) {
        for (const value of values) {
            const inputs = { prompt: 'hi', [key]: value };
            const expected = { ok: false, error: `inputs_invalid:${key}` };
            assert.deepEqual(validateInputs(inputs), expected, `${key}=${value}`);
            assert.deepEqual(checkInputs(key.startsWith('dialogue_') ? dialogue : minimax, inputs), expected, `${key}=${value}`);
        }
    }
    assert.deepEqual(validateInputs({ dialogue_voice_5: 'Aria' }), { ok: false, error: 'inputs_key_not_allowed:dialogue_voice_5' });
});

test('MiniMax retains and maps the complete web input payload', () => {
    const retained = declaredInputs(minimax, webInputs);
    assert.deepEqual(retained, webInputs);
    assert.deepEqual(shapePayload(minimax, retained), {
        prompt: 'Hello there', output_format: 'url', language_boost: 'auto',
        voice_setting: { voice_id: 'Wise_Woman', speed: 1, vol: 1, pitch: 0, emotion: 'neutral' },
    });
    assert.deepEqual(shapePayload(minimax, { prompt: 'hi', ...ttsGenerationInputs({
        voice: 'Deep_Voice_Man', speed: 1.5, volume: 8, pitch: -3, emotion: 'happy', language: 'Chinese,Yue',
    }) }), {
        prompt: 'hi', output_format: 'url', language_boost: 'Chinese,Yue',
        voice_setting: { voice_id: 'Deep_Voice_Man', speed: 1.5, vol: 8, pitch: -3, emotion: 'happy' },
    });
});

test('MiniMax preserves omitted defaults and floors the studio volume to fal minimum', () => {
    assert.deepEqual(shapePayload(minimax, { prompt: 'hi' }), { prompt: 'hi', output_format: 'url' });
    assert.deepEqual(shapePayload(minimax, { prompt: 'hi', tts_volume: 0 }), {
        prompt: 'hi', output_format: 'url', voice_setting: { vol: 0.01 },
    });
    assert.deepEqual(shapePayload(minimax, { prompt: 'hi', tts_pitch: 0, tts_speed: 0.5 }), {
        prompt: 'hi', output_format: 'url', voice_setting: { pitch: 0, speed: 0.5 },
    });
    assert.deepEqual(shapePayload(minimax, { prompt: 'hi', tts_language: 'English' }), {
        prompt: 'hi', output_format: 'url', language_boost: 'English',
    });
    assert.deepEqual(declaredInputs(minimax, { prompt: 'hi', voice_description: 'Warm', aspect_ratio: '16:9' }), { prompt: 'hi' });
});

test('dialogue uses the cast in first-appearance order, preserving seed and repeated speakers', () => {
    const inputs = { prompt: 'Ben: Hello\nAna: Hi\nBen: Again\nCara: Goodbye', seed: 7,
        ...dialogueCastInputs([{ speaker: 'Ben', voice: 'George' }, { speaker: 'Ana', voice: 'Sarah' }]) };
    assert.deepEqual(checkInputs(dialogue, inputs), { ok: true });
    assert.deepEqual(declaredInputs(dialogue, inputs), inputs);
    assert.deepEqual(shapePayload(dialogue, inputs), { seed: 7, inputs: [
        { text: 'Hello', voice: 'George' }, { text: 'Hi', voice: 'Sarah' },
        { text: 'Again', voice: 'George' }, { text: 'Goodbye', voice: 'Aria' },
    ] });
    assert.deepEqual(shapePayload(dialogue, { prompt: 'Ben: Hello\nAna: Hi' }), {
        inputs: [{ text: 'Hello', voice: 'Aria' }, { text: 'Hi', voice: 'Roger' }],
    });
});

test('dialogue refuses duplicate and gapped cast orders before submission', () => {
    for (const cast of [
        { dialogue_voice_1: 'George', dialogue_voice_2: 'George' },
        { dialogue_voice_2: 'Sarah' },
        { dialogue_voice_1: 'George', dialogue_voice_3: 'Sarah' },
    ]) assert.deepEqual(checkInputs(dialogue, { prompt: 'Ana: Hi', ...cast }), { ok: false, error: 'dialogue_invalid' });
});

test('public catalog hides studio-only speech controls and provider field names', () => {
    for (const record of [minimax, dialogue]) {
        const caps = publicCapabilities(record);
        for (const key of SPEECH_CONTROL_KEYS) assert.equal(Object.hasOwn(caps.inputs, key), false, key);
        assert.equal(Object.hasOwn(caps.inputs, 'prompt'), true);
        assert.equal(JSON.stringify(caps).includes('voice_setting'), false);
        assert.equal(JSON.stringify(caps).includes('language_boost'), false);
    }
    // Hidden from the public view, still declared: the model accepts them.
    assert.deepEqual(Object.keys(declaredInputs(minimax, { prompt: 'x', tts_voice: 'Wise_Woman' })).sort(), ['prompt', 'tts_voice']);
});

test('server speech bounds sit inside fal\'s live MiniMax schema', () => {
    const doc = JSON.parse(readFileSync(new URL('./fixtures/fal-minimax-speech-input.json', import.meta.url), 'utf8'));
    const { schemas } = doc.components;
    const voice = schemas.VoiceSetting.properties;
    const boost = schemas.MinimaxSpeech26HdInput.properties.language_boost.anyOf.find((v) => v.enum).enum;
    for (const language of TTS_LANGUAGE_VALUES) assert.ok(boost.includes(language), language);
    for (const emotion of TTS_EMOTION_VALUES) assert.ok(voice.emotion.anyOf.find((v) => v.enum).enum.includes(emotion), emotion);
    for (const id of TTS_VOICE_IDS) assert.ok(voice.voice_id.examples.includes(id), id);
    assert.equal(minimax.inputs.tts_speed.min, voice.speed.minimum);
    assert.equal(minimax.inputs.tts_speed.max, voice.speed.maximum);
    assert.equal(minimax.inputs.tts_pitch.min, voice.pitch.minimum);
    assert.equal(minimax.inputs.tts_pitch.max, voice.pitch.maximum);
    for (const volume of [0, 10]) {
        const vol = shapePayload(minimax, { prompt: 'x', tts_volume: volume }).voice_setting.vol;
        assert.ok(vol >= voice.vol.minimum && vol <= voice.vol.maximum, String(volume));
    }
});

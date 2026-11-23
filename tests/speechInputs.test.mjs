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

// Qwen owns a separate contract. Keep all MiniMax assertions above unchanged.
const { QWEN_VOICES, QWEN_LANGUAGES, QWEN_SCRIPT_LIMIT } = await import('../lib/qwenSpeechInputs.js');
const { speechContractFor } = await import('../lib/speechInputs.js');
const { defaultSpeechSettings, speechContractFor: webContract } = await import('../app/veyrnox/_lib/textToSpeech.js');
const { buildRequest, parseEndpoint, endpointKind, interpretTask, submitTask } = await import('../packages/adapters/crun.js');
const { providerFor } = await import('../packages/provider-sdk/registry.js');
const qwenEndpoint = 'crun:qwen3-tts/speech-synthesis';
const qwen = capabilityFor(qwenEndpoint);
const target = parseEndpoint(qwenEndpoint);

test('Qwen contract is identical on web and server, public, and separate from MiniMax', () => {
    assert.equal(QWEN_VOICES.length, 35);
    assert.equal(QWEN_SCRIPT_LIMIT, 600);
    assert.equal(speechContractFor('minimax-speech-2.6-hd').scriptLimit, 500);
    for (const id of ['qwen3-tts', 'minimax-speech-2.6-hd']) assert.deepEqual(webContract(id), speechContractFor(id));
    assert.deepEqual(speechContractFor('qwen3-tts').controls, []);
    const caps = publicCapabilities(qwen);
    assert.equal(caps.inputs.prompt.max, 600);
    assert.deepEqual(caps.inputs.tts_voice.values, QWEN_VOICES.map(v => v.id));
    assert.deepEqual(caps.inputs.tts_language.values, QWEN_LANGUAGES);
    assert.deepEqual(caps.speech.voices, QWEN_VOICES);
    // 'speech', not 'audio': the video/image sweep settles speech, while 'audio' routes (Suno music) are excluded from it.
    assert.equal(endpointKind(qwenEndpoint), 'speech');
    assert.deepEqual(ttsGenerationInputs(defaultSpeechSettings('qwen3-tts'), 'qwen3-tts'), { tts_voice: 'Cherry', tts_language: 'auto' });
});

test('Qwen accepts its pinned voices and languages; both models reject cross-model controls before submit', () => {
    for (const voice of QWEN_VOICES) {
        const inputs = { prompt: 'Hello', tts_voice: voice.id };
        assert.deepEqual(validateInputs(inputs), { ok: true });
        assert.deepEqual(checkInputs(qwen, inputs), { ok: true });
        assert.equal(providerFor('crun').check(qwen, { provider_endpoint: qwenEndpoint }, inputs).ok, true);
        assert.deepEqual(checkInputs(minimax, inputs), { ok: false, error: 'inputs_invalid:tts_voice' });
    }
    for (const voice of TTS_VOICE_IDS) {
        const inputs = { prompt: 'Hello', tts_voice: voice };
        assert.deepEqual(checkInputs(qwen, inputs), { ok: false, error: 'inputs_invalid:tts_voice' });
        assert.deepEqual(buildRequest(target, inputs), { ok: false, error: 'inputs_invalid:tts_voice' });
    }
    for (const language of QWEN_LANGUAGES) {
        const inputs = { prompt: 'Hello', tts_language: language };
        assert.equal(validateInputs(inputs).ok, true);
        assert.equal(buildRequest(target, inputs).body.input.language_type, language === 'auto' ? 'Auto' : language);
    }
    for (const key of ['tts_emotion', 'tts_speed', 'tts_volume', 'tts_pitch', 'instructions', 'unknown']) {
        const inputs = { prompt: 'Hello', [key]: 'ignored?' };
        assert.deepEqual(buildRequest(target, inputs), { ok: false, error: `inputs_key_not_allowed:${key}` });
        assert.equal(checkInputs(qwen, inputs).ok, false);
    }
});

test('Qwen request is exact, bounded and refuses unsupported fields instead of dropping them', () => {
    assert.deepEqual(buildRequest(target, { prompt: 'Hello' }), { ok: true, body: {
        model: 'qwen3-tts/speech-synthesis', input: { text: 'Hello', voice: 'Cherry', language_type: 'Auto' },
    } });
    assert.equal(buildRequest(target, { prompt: 'x'.repeat(600) }).ok, true);
    for (const prompt of ['', '   ', undefined]) assert.deepEqual(buildRequest(target, { prompt }), { ok: false, error: 'prompt_required' });
    assert.deepEqual(buildRequest(target, { prompt: 'x'.repeat(601) }), { ok: false, error: 'inputs_invalid:prompt' });
    assert.deepEqual(checkInputs(qwen, { prompt: 'x'.repeat(601) }), { ok: false, error: 'inputs_invalid:prompt' });
    for (const [key, value] of [['tts_voice', 'Jada'], ['tts_voice', 'Eldric Sage'], ['tts_voice', null], ['tts_language', 'Russian'], ['tts_language', 'Auto']]) {
        assert.deepEqual(buildRequest(target, { prompt: 'Hello', [key]: value }), { ok: false, error: `inputs_invalid:${key}` });
    }
    for (const duration_seconds of [null, 5, undefined]) assert.equal(buildRequest(target, { prompt: 'Hello', duration_seconds }).ok, true);
    assert.deepEqual(buildRequest(target, { prompt: 'Hello', duration_seconds: 10 }), { ok: false, error: 'duration_not_supported' });
});

test('Qwen submit uses Crun CreateTask, API header, exact JSON and redacts upstream text', async () => {
    const original = globalThis.fetch;
    const job = { job_id: 'qwen-test', provider_endpoint: qwenEndpoint, inputs: { prompt: 'Private script', tts_voice: 'Serena', tts_language: 'French' } };
    try {
        globalThis.fetch = async (url, options) => {
            assert.equal(url, 'https://api.crun.ai/api/v1/client/job/CreateTask');
            assert.equal(options.headers['X-API-KEY'], 'test-key');
            assert.equal(options.method, 'POST');
            assert.deepEqual(JSON.parse(options.body), { model: 'qwen3-tts/speech-synthesis', input: { text: 'Private script', voice: 'Serena', language_type: 'French' } });
            return Response.json({ code: 200, data: { task_id: 'qwen-task' } });
        };
        assert.deepEqual(await submitTask(job, { apiKey: 'test-key' }), { ok: true, providerJobId: 'qwen-task' });
        globalThis.fetch = async () => Response.json({ code: 400, message: 'invalid: Private script' }, { status: 400 });
        const refusal = await submitTask(job, { apiKey: 'test-key' });
        assert.equal(refusal.ok, false);
        assert.equal(refusal.error.includes('Private script'), false);
    } finally { globalThis.fetch = original; }
    assert.deepEqual(interpretTask({ data: { status: 'success', result: { media_urls: ['https://static.mediaoss.bar/speech.wav'] } } }), { ok: true, state: 'success', outputUrl: 'https://static.mediaoss.bar/speech.wav' });
    assert.equal(interpretTask({ data: { status: 'success', result: { media_urls: ['http://static.mediaoss.bar/speech.wav'] } } }).ok, false);
});

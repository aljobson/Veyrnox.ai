import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { EDITOR_INTENTS, matchEditorIntent, routeEditorIntent, dispatchEditorIntent, editorTimelineMedia } from '../app/veyrnox/_lib/editorIntentRouter.mjs';
import { emptySequence, addSequenceMedia, addSequenceClip } from '../app/veyrnox/_lib/editorSequence.mjs';
import { buildAgentRequest, stubModel, checkPlan } from '../app/veyrnox/_lib/editorAgentPlan.mjs';
import * as router from '../app/veyrnox/_lib/editorIntentRouter.mjs';
import * as generation from '../app/veyrnox/_lib/editorGeneration.mjs';
import { englishAppImports } from './helpers/appI18nStub.mjs';
import { hookHarness, nodes, readEditorSource } from './helpers/editorRoundHarness.mjs';
const phrases = ['add captions', 'smart cut', 'find clips', 'generate video of a lake', 'generate voiceover hello', 'generate avatar', 'split the first clip at 2 seconds'];
const features = { captions: true, localInference: true, clipper: true, video: true, voiceover: true, avatar: true, agent: true };
const tl = addSequenceClip(addSequenceMedia(emptySequence(), { id: 'l-1', kind: 'video', frames: 300, width: 1280, height: 720, hasAudio: true }), 'video', 'l-1');
const context = { features, media: editorTimelineMedia(tl) };
test('each declared intent dispatches exactly one existing panel and declares media, price confirmation and feature', () => {
    for (const [i, id] of Object.keys(EDITOR_INTENTS).entries()) {
        const intent = routeEditorIntent(phrases[i], context), calls = [];
        assert.equal(intent.id, id); assert.equal(intent.ready, true);
        assert.equal(dispatchEditorIntent(intent, (...args) => calls.push(args)), true);
        assert.equal(calls.length, 1); assert.equal(calls[0][0], EDITOR_INTENTS[id].panel);
        assert.equal(calls[0][1].prompt, phrases[i]); assert.ok(intent.feature);
        assert.equal(intent.confirm, intent.paid ? 'catalog-price' : 'panel-preview');
    }
});
test('flags, unavailable catalog models and missing timeline media fail closed; unsupported gives no action', () => {
    for (const phrase of phrases) {
        const spec = routeEditorIntent(phrase, context);
        const off = routeEditorIntent(phrase, { ...context, features: { ...features, [spec.feature]: false } });
        assert.equal(off.reason, 'unavailable'); assert.equal(dispatchEditorIntent(off, () => assert.fail()), false);
        if (spec.media) assert.equal(routeEditorIntent(phrase, { ...context, media: {} }).reason, 'missingMedia');
    }
    assert.equal(routeEditorIntent('make me famous', context).id, 'unsupported');
    assert.equal(dispatchEditorIntent(routeEditorIntent('make me famous', context), () => assert.fail()), false);
});
test('timeline instruction passes the existing validator and does not mutate the current timeline', () => {
    const intent = routeEditorIntent(phrases[6], context);
    const result = checkPlan(tl, stubModel(buildAgentRequest(tl, intent.prompt), tl));
    assert.equal(result.ok, true); assert.equal(result.next.video.length, 2); assert.equal(tl.video.length, 1);
});
test('native four-action matcher mirrors web semantics without adding capabilities', () => {
    const exports = {};
    new Function('exports', ts.transpileModule(readEditorSource('apps/mobile/src/lib/editorIntentRouter.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(exports);
    for (const text of [...phrases, 'MAKE AUDIO waves', '', 'something else']) assert.equal(exports.matchEditorIntent(text), matchEditorIntent(text));
    assert.deepEqual(phrases.map(exports.mobileEditorAction), ['captions', 'smart-cut', null, 'make-clip', 'make-audio', null, null]);
});
test('real prompt box dispatches all enabled panel entry points and never submits a job', () => {
    const h = hookHarness(), calls = [];
    const model = { id: 'video', kind: 'video', credits: 12, takesPrompt: true, durations: [5], aspects: ['16:9'] };
    const models = [model, { ...model, id: 'voice', kind: 'audio', isSpeech: true }, { ...model, id: 'kling-avatar-v2', media: { image: { required: true }, audio: { required: true, maxSeconds: 10 } } }];
    const { EditorIntentBox } = h.load('app/veyrnox/_components/editor/EditorIntentBox.js', {
        ...englishAppImports, '../../_lib/editorIntentRouter.mjs': router, '../../_lib/editorGeneration.mjs': generation,
        '../../_lib/useCatalog': { useCatalog: () => ({ live: true, models }) }, '../Button': { Button: 'button' },
    });
    const props = { tl, flags: features, onOpen: (...args) => calls.push(args) };
    const tree = h.render(EditorIntentBox, props);
    const buttons = nodes(tree).filter(node => node.type === 'button' && node.props.type === 'button');
    assert.equal(buttons.length, 7);
    for (const button of buttons) button.props.onClick();
    assert.deepEqual(calls.map(call => call[0]), Object.values(EDITOR_INTENTS).map(spec => spec.panel));
    const off = h.render(EditorIntentBox, { ...props, flags: { localInference: false, agent: false, clipper: false } });
    assert.equal(nodes(off).filter(node => node.type === 'button' && node.props.type === 'button').length, 4);
    h.states[0]('find clips');
    const blocked = h.render(EditorIntentBox, { ...props, flags: {} });
    nodes(blocked).find(node => node.type === 'form').props.onSubmit({ preventDefault() {} });
    assert.equal(calls.length, 7);
});

const specificPhrases = [
    ['captions', 'add_captions'], ['subtitles', 'add_captions'],
    ['remove the silences', 'cut_silence_or_speech'], ['remove ums', 'cut_silence_or_speech'],
    ['remove filler words', 'cut_silence_or_speech'], ['remove ums/filler words', 'cut_silence_or_speech'],
    ['generate captions for my video', 'add_captions'], ['create subtitles for the video', 'add_captions'],
    ['make a clip from my video', 'find_clips'], ['extract clips from my video', 'find_clips'],
    ['make the audio louder', 'unsupported'], ['make the audio quieter', 'unsupported'],
    ['generate a cinematic video of a lake', 'generate_video'],
    ['make something that would be good as a video', 'unsupported'],
    ['remove the captions', 'unsupported'], ['delete captions', 'unsupported'],
    ['turn off subtitles', 'unsupported'], ['hide captions', 'unsupported'],
    ['remove silence', 'cut_silence_or_speech'], ['delete audio and make a video', 'unsupported'],
    ['hide voice and generate avatar', 'unsupported'],
    ['remove the first clip', 'timeline_edit'],
    ['make a video with captions', 'generate_video'], ['make a video with audio', 'generate_video'],
    ['create a video with voice', 'generate_video'], ['generate a video with narration', 'generate_video'],
    ['make audio for a video', 'generate_voiceover'], ['create a voice for a video', 'generate_voiceover'],
    ['generate voiceover with captions', 'generate_voiceover'], ['make an avatar with audio', 'generate_avatar'],
];
test('web and native route the requested object and reject negative tool requests', () => {
    const native = {};
    new Function('exports', ts.transpileModule(readEditorSource('apps/mobile/src/lib/editorIntentRouter.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(native);
    for (const [phrase, expected] of specificPhrases) {
        assert.equal(matchEditorIntent(phrase), expected, `web: ${phrase}`);
        assert.equal(native.matchEditorIntent(phrase), expected, `native: ${phrase}`);
        if (expected === 'unsupported') {
            assert.equal(native.mobileEditorAction(phrase), null);
            assert.equal(dispatchEditorIntent(routeEditorIntent(phrase, context), () => assert.fail('negative request dispatched')), false);
        }
    }
});

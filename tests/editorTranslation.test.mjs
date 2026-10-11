import test from 'node:test';
import assert from 'node:assert/strict';
import { translateCaptionCues, translationAvailability, translationProblem } from '../app/veyrnox/_lib/editorTranslation.mjs';
const cues = [{ id: 't1', caption: true, text: 'Hello world', start: 30, len: 60, style: { font: 'Georgia' }, words: [{ text: 'Hello', start: 0, len: 30 }, { text: 'world', start: 30, len: 30 }], wordsEstimated: false, wordStyle: { mode: 'karaoke', color: '#ffffff' } }, { id: 't2', caption: true, text: 'Goodbye', start: 120, len: 30 }];
test('on-device translation preserves cue identity, timing and style while removing invalid word alignment', async () => {
    let destroyed = 0, created = false; const received = [], progress = [];
    const runtime = { create(options) { created = true; assert.equal(options.sourceLanguage, 'en'); assert.equal(options.targetLanguage, 'fr'); return Promise.resolve({ translate: async text => { received.push(text); return text === 'Hello world' ? 'Bonjour le monde' : 'Au revoir'; }, destroy() { destroyed++; } }); } };
    const request = translateCaptionCues(cues, { sourceLanguage: 'en', targetLanguage: 'fr', runtime, onProgress: event => progress.push(event) });
    assert.equal(created, true, 'runtime is created synchronously in the user activation turn');
    const translated = await request;
    assert.deepEqual(received, ['Hello world', 'Goodbye']); assert.equal(translated[0].text, 'Bonjour le monde'); assert.equal(translated[0].id, 't1'); assert.equal(translated[0].start, 30); assert.equal(translated[0].len, 60); assert.deepEqual(translated[0].style, cues[0].style);
    assert.equal('words' in translated[0], false); assert.equal('wordStyle' in translated[0], false); assert.equal(cues[0].words.length, 2); assert.equal(cues[0].text, 'Hello world'); assert.equal(destroyed, 1); assert.equal(progress.at(-1).fraction, 1);
});
test('an invalid later translation rejects the whole operation and releases the model', async () => {
    let calls = 0, destroyed = 0;
    const runtime = { create: async () => ({ translate: async () => ++calls === 1 ? 'Valid' : 'a'.repeat(1001), destroy() { destroyed++; } }) };
    await assert.rejects(translateCaptionCues(cues, { sourceLanguage: 'en', targetLanguage: 'es', runtime }), /too long or invalid/);
    assert.equal(cues[0].text, 'Hello world'); assert.equal(destroyed, 1);
});
test('cancellation during translation cannot return a partial result or leak its translator', async () => {
    const controller = new AbortController(); let destroyed = 0, calls = 0;
    const runtime = { create: async () => ({ translate: async () => { calls++; controller.abort(); return 'Bonjour'; }, destroy() { destroyed++; } }) };
    await assert.rejects(translateCaptionCues(cues, { sourceLanguage: 'en', targetLanguage: 'fr', runtime, signal: controller.signal }), { name: 'AbortError' });
    assert.equal(calls, 1); assert.equal(destroyed, 1);
});
test('feature and language detection refuse unsupported or malformed input without model creation', async () => {
    assert.equal(await translationAvailability('en', 'fr', {}), 'unavailable');
    assert.equal(await translationAvailability('en', 'fr', { availability: async () => 'downloadable', create() {} }), 'downloadable');
    assert.match(translationProblem(cues, 'en', 'EN'), /different target/);
    assert.match(translationProblem(cues, 'en<script>', 'fr'), /valid source/);
    await assert.rejects(translateCaptionCues(cues, { sourceLanguage: 'en', targetLanguage: 'fr', runtime: {} }), /unavailable/);
});

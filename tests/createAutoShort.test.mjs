import test from 'node:test';
import assert from 'node:assert/strict';
import { createPromptModelAvailable } from '../app/veyrnox/_lib/templateDraft.js';
import { fromApi } from '../app/veyrnox/_lib/useCatalog.js';
import { readFileSync } from 'node:fs';

// JSX page, so this reads the source, like createDeepLink.test.mjs.
const page = readFileSync(new URL('../app/veyrnox/app/create/page.js', import.meta.url), 'utf8');
const catalog = readFileSync(new URL('../app/veyrnox/_lib/useCatalog.js', import.meta.url), 'utf8');
const errors = readFileSync(new URL('../app/veyrnox/_lib/createErrors.js', import.meta.url), 'utf8');

test('Auto Short is hidden from the picker unless localStorage.veyrnox_auto_short is "1"', () => {
    assert.match(page, /const AUTO_SHORT_FLAG = 'veyrnox_auto_short';/);
    assert.match(page, /localStorage\.getItem\(name\) === '1'/);
    // The Clip Editor edits Library files, so Create never offers it, flag or not.
    // Nor the video agent, which is bought from a plan on its own page (found on staging 2026-10-09: it was in the picker).
    assert.match(page, /const models = catalogModels\.filter\(\(m\) => createPromptModelAvailable\(m, autoShortOn\)\);/);
    assert.match(catalog, /takesPlan: !!m\.capabilities\?\.inputs\?\.plan_id/);
    assert.match(catalog, /isEdit: !!m\.capabilities\?\.inputs\?\.clips/);
    // The catalog marks it by its capability, not by a hard-coded id.
    assert.match(catalog, /takesTopic: !!m\.capabilities\?\.inputs\?\.topic/);
    // Exercise the API capability mapping as well as the shared picker rule.
    for (const input of ['clips', 'plan_id', 'topic']) {
        const [model] = fromApi([{ id: input, capabilities: { inputs: { [input]: {} } } }]);
        assert.equal(createPromptModelAvailable(model), false, `${input} is hidden by default`);
        assert.equal(createPromptModelAvailable(model, false), false, `${input} is hidden with the flag off`);
        assert.equal(createPromptModelAvailable(model, true), input === 'topic', 'only topic models can opt in');
    }
    const [ordinary] = fromApi([{ id: 'ordinary', capabilities: { inputs: { prompt: {} } } }]);
    assert.equal(createPromptModelAvailable(ordinary, false), true);
    assert.equal(createPromptModelAvailable(ordinary, true), true);
});

test('an Auto Short sends only its topic, with no camera, aspect or length controls', () => {
    assert.match(page, /const inputs = isShort \? \{ topic: prompt\.trim\(\) \} :/);
    assert.match(page, /const takesCamera = !isShort && /);
    assert.match(page, /const aspectOptions = isShort \? \[\]/);
});

test('refusals and bad topics have their own copy', () => {
    assert.match(errors, /topic_refused:/);
    assert.match(errors, /'inputs_invalid:topic':/);
});

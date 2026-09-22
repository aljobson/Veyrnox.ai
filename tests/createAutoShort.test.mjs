import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// JSX page, so this reads the source, like createDeepLink.test.mjs.
const page = readFileSync(new URL('../app/veyrnox/app/create/page.js', import.meta.url), 'utf8');
const catalog = readFileSync(new URL('../app/veyrnox/_lib/useCatalog.js', import.meta.url), 'utf8');
const errors = readFileSync(new URL('../app/veyrnox/_lib/createErrors.js', import.meta.url), 'utf8');

test('Auto Short is hidden from the picker unless localStorage.veyrnox_auto_short is "1"', () => {
    assert.match(page, /const AUTO_SHORT_FLAG = 'veyrnox_auto_short';/);
    assert.match(page, /localStorage\.getItem\(name\) === '1'/);
    assert.match(page, /const models = autoShortOn \? catalogModels : catalogModels\.filter\(\(m\) => !m\.takesTopic\);/);
    // The catalog marks it by its capability, not by a hard-coded id.
    assert.match(catalog, /takesTopic: !!m\.capabilities\?\.inputs\?\.topic/);
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

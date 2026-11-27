import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('web and mobile editors expose local face retouch behind a fresh rights acknowledgement', async () => {
    const [web, webEntry, mobile, mobileEntry] = await Promise.all([
        read('app/veyrnox/app/photo-studio/page.js'), read('app/veyrnox/_components/editor/FilterPanel.js'),
        read('apps/mobile/src/components/liveEdit/FaceRetouchScreen.tsx'), read('apps/mobile/src/components/editor/tools/EffectsPanel.tsx'),
    ]);
    assert.match(web, /BindingText id="mediaRights"/); assert.match(web, /disabled={!rights}/); assert.match(webEntry, /href="\/app\/photo-studio"/);
    assert.match(mobile, /checked={rights}/); assert.match(mobile, /disabled={!rights \|\| busy}/); assert.match(mobile, /if \(next\) return;[\s\S]*clearSource\(\); setSource\(null\); setInference\(null\)/); assert.match(mobile, /getCacheUser\(\) !== owner[\s\S]*setRights\(false\)/); assert.match(mobileEntry, /router\.push\('\/live-edit'\)/);
    for (const source of [web, mobile]) assert.doesNotMatch(source, /gatewayFetch|\/api\/|credits/i);
});

test('mobile preview and saved output use one bounded local renderer', async () => {
    const [surface, preview, output, engine] = await Promise.all([
        read('apps/mobile/src/components/liveEdit/FaceRetouchScreen.tsx'), read('apps/mobile/src/components/liveEdit/EffectPhoto.tsx'),
        read('apps/mobile/src/lib/lookExport.ts'), read('apps/mobile/src/lib/liveEdit/engine.ts'),
    ]);
    assert.match(surface, /normalizeStack\(\{ smoothing: strength \}\)/); assert.match(surface, /step={0\.05}/);
    assert.match(preview, /renderEffectStack/); assert.match(output, /renderEffectStack/); assert.match(engine, /normalizeStack/);
    assert.match(surface, /inference\?\.count !== 1/); assert.match(surface, /value\.count > 1 \? 'multiple'/); assert.match(surface, /compare \? DEFAULT_STACK/);
});

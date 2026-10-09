import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TOOL_TASKS, isTool, toolNeeds, toolGroups } from '../app/veyrnox/_lib/tools.js';

const m = (id, media) => ({ id, capabilities: { media } });
const MODELS = [
    m('seedream-4', {}),
    m('topaz-upscale', { image: { required: true } }),
    m('kling-avatar-v2', { image: { required: true }, audio: { required: true } }),
    m('kling-3.0-i2v', { image: { required: true }, endImage: { required: false } }),
    m('brand-new-tool', { video: { required: true } }),
    m('optional-only', { image: { required: false } }),
];

test('a tool is a model that cannot run without an upload', () => {
    assert.deepEqual(MODELS.filter(isTool).map((x) => x.id), ['topaz-upscale', 'kling-avatar-v2', 'kling-3.0-i2v', 'brand-new-tool']);
    assert.equal(isTool({}), false);
});

test('needs lists only the required uploads, in words', () => {
    assert.equal(toolNeeds(MODELS[2]), 'an image and audio');
    assert.equal(toolNeeds(MODELS[3]), 'an image');
});

test('tools group by task, empty tasks are dropped, and an unlisted tool is never hidden', () => {
    const groups = toolGroups(MODELS);
    assert.deepEqual(groups.map((g) => [g.key, g.tools.map((t) => t.id).join(',')]), [
        ['upscale', 'topaz-upscale'], ['animate', 'kling-3.0-i2v'], ['avatar', 'kling-avatar-v2'], ['other', 'brand-new-tool'],
    ]);
    assert.deepEqual(toolGroups([]), []);
});

test('no model id is listed under two tasks', () => {
    const ids = TOOL_TASKS.flatMap((t) => t.ids);
    assert.equal(new Set(ids).size, ids.length);
});

test('/tools is routed, in the sitemap and survives a catalog outage', () => {
    const config = readFileSync(new URL('../next.config.mjs', import.meta.url), 'utf8');
    assert.match(config, /source: '\/tools', destination: '\/veyrnox\/tools'/);
    assert.match(readFileSync(new URL('../app/sitemap.js', import.meta.url), 'utf8'), /page\('\/tools'/);
    const page = readFileSync(new URL('../app/veyrnox/tools/page.js', import.meta.url), 'utf8');
    assert.match(page, /catch \(err\)/);
    assert.match(page, /The tool list is unavailable right now/);
});

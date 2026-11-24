import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { translateEditorRender } from '../lib/editorServerRenderTranslate.js';
const fixture = version => JSON.parse(readFileSync(new URL(`./fixtures/editorServerRender/${version}.json`, import.meta.url)));
for (const version of ['v2', 'v3']) test(`${version}: pure ordered translation, trim, placement, dissolve, audio, volume and text`, () => {
    const tl = fixture(version), before = structuredClone(tl);
    const result = translateEditorRender(tl), commands = result.calls.filter(c => c.method === 'edit.apply').map(c => c.params.command);
    assert.deepEqual(tl, before);
    assert.equal(result.calls[0].method, 'project.create');
    assert.deepEqual(result.calls[0].params.video, { width: 1920, height: 1080, rateNum: 30, rateDen: 1 });
    assert.equal(result.calls.at(-1).method, 'export.run');
    assert.deepEqual(commands.filter(c => c.op === 'trimClip').map(c => [c.edge, c.delta]), [['start', 1], ['end', -7], ['end', -7], ['start', 2], ['end', -5]]);
    assert.deepEqual(commands.filter(c => c.op === 'moveClips').map(c => c.moves[0].start), version === 'v2' ? [0, 2, 1] : [1, 3, 1]);
    assert.deepEqual(commands.filter(c => c.op === 'updateClip').map(c => c.patch), [{ volume: .5 }, { transitionIn: { id: 'concat.dissolve', duration: .5 } }, { volume: .25 }]);
    assert.equal(commands.at(-1).op, 'addTextClip');
    assert.equal(commands.at(-1).start, .5);
    assert.equal(commands.at(-1).duration, 2);
    assert.ok(Math.abs(commands.at(-1).offsetY - .3) < 1e-9);
});
test('unsupported transition and text edits are explicit, with no partial calls', () => {
    for (const [mutate, feature] of [[t => { t.video[0].transitionType = 'unknown'; }, 'transitionType'], [t => { t.text[0].x = .2; }, 'text.x'], [t => { t.text[0].style = {}; }, 'text.style'], [t => { t.video[0].reverse = true; }, 'reverse']]) {
        const tl = fixture('v3'); mutate(tl);
        assert.deepEqual(translateEditorRender(tl), { error: 'editor_render_unsupported', feature });
    }
});
test('resolution caps are enforced before a call plan is returned', () => {
    const tl = fixture('v3'); tl.video = [tl.video[0]]; tl.video[0].in = 0; tl.video[0].start = 0; tl.video[0].len = 3601;
    tl.media[tl.video[0].mediaId].frames = 18000;
    assert.equal(translateEditorRender(tl).error, 'editor_render_duration_limit');
    assert.equal(translateEditorRender(tl, { resolution: '720p' }).width, 1280);
    tl.video[0].len = 9001;
    assert.equal(translateEditorRender(tl, { resolution: '720p' }).error, 'editor_render_duration_limit');
});
test('4K 60 fps changes the render project while timeline timing stays source-time based', () => {
    const tl = fixture('v3');
    const result = translateEditorRender(tl, { resolution: '2160p', frameRate: 60 });
    assert.equal(result.error, undefined);
    assert.deepEqual([result.width, result.height, result.frameRate, result.maxOutputBytes], [3840, 2160, 60, 100 * 1024 * 1024]);
    assert.deepEqual(result.calls[0].params.video, { width: 3840, height: 2160, rateNum: 60, rateDen: 1 });
    assert.equal(result.calls.at(-1).params.width, 3840);
    assert.equal(result.calls.at(-1).params.height, 2160);
    assert.equal(translateEditorRender(tl, { resolution: '2160p', frameRate: 50 }).feature, 'canvas.frame_rate');
});
test('4:5, canonical custom, and source canvases keep their ratio independently of resolution', () => {
    const tl = fixture('v3');
    tl.aspect = '4:5';
    assert.deepEqual([translateEditorRender(tl).width, translateEditorRender(tl).height], [1080, 1350]);
    tl.aspect = 'custom:5x8';
    assert.deepEqual([translateEditorRender(tl).width, translateEditorRender(tl).height], [1080, 1728]);
    tl.aspect = 'source';
    const first = tl.media[tl.video[0].mediaId]; first.width = 1000; first.height = 2000;
    assert.deepEqual([translateEditorRender(tl).width, translateEditorRender(tl).height], [1080, 2160]);
    tl.aspect = 'custom:10x16';
    assert.equal(translateEditorRender(tl).error, 'editor_render_invalid_document');
});
test('extreme custom canvases preserve their ratio inside the server render dimension cap', () => {
    const tl = fixture('v3');
    tl.aspect = 'custom:1x4';
    const result = translateEditorRender(tl, { resolution: '2160p' });
    assert.deepEqual([result.width, result.height], [1024, 4096]);
    assert.deepEqual(result.calls[0].params.video, { width: 1024, height: 4096, rateNum: 30, rateDen: 1 });
    assert.deepEqual([result.calls.at(-1).params.width, result.calls.at(-1).params.height], [1024, 4096]);
});
test('invalid schemas and unimplemented visual features cannot disappear silently', () => {
    const tl = fixture('v3'); tl.video[0].filter = { brightness: 2 };
    assert.equal(translateEditorRender(tl).feature, 'filter');
    assert.equal(translateEditorRender({ schemaVersion: 1 }).feature, 'schemaVersion');
});

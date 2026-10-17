import test from 'node:test';
import assert from 'node:assert/strict';
import { SCENE_BOUNDS, checkSceneBounds, cutsToTimelineFrames, partitionCuts } from '../app/veyrnox/_lib/editorSceneRun.mjs';
import { editorFeatureEnabled } from '../lib/editorRuntimeFlags.mjs';
import { readFileSync } from 'node:fs';
import { parseJsonc } from '../scripts/check-migration-ledger.mjs';

const media = (over = {}) => ({ kind: 'video', width: 1280, height: 720, frames: 900, ...over });
const clip = (over = {}) => ({ id: 'v1', mediaId: 'm', in: 0, len: 300, ...over });

test('a clip inside the measured bounds is accepted, at the 30 s and 720p edges too', () => {
    assert.equal(checkSceneBounds(media(), clip()), null);
    assert.equal(checkSceneBounds(media(), clip({ len: SCENE_BOUNDS.maxSeconds * 30 })), null);
    assert.equal(checkSceneBounds(media({ width: 720, height: 1280 }), clip()), null, 'portrait 720p is the same pixel count');
});

test('input past the bounds, or not video, is refused with a plain message', () => {
    assert.match(checkSceneBounds(media(), clip({ len: 901 })), /up to 30 seconds/);
    assert.match(checkSceneBounds(media({ width: 1920, height: 1080 }), clip()), /up to 720p/);
    assert.match(checkSceneBounds(media({ kind: 'image' }), clip()), /video clips/);
    assert.match(checkSceneBounds(null, clip()), /video clips/);
    assert.match(checkSceneBounds(media(), clip({ len: 2 })), /longer/);
    assert.match(checkSceneBounds(media(), null), /longer/);
});

test('source-time cuts become timeline frames, honouring where the clip starts in its source and on the timeline', () => {
    const cuts = [{ time: 4 }, { time: 8 }, { time: 12 }];
    assert.deepEqual(cutsToTimelineFrames(clip({ in: 0, len: 600 }), 0, cuts), [120, 240, 360]);
    assert.deepEqual(cutsToTimelineFrames(clip({ in: 90, len: 300 }), 30, cuts), [60, 180, 300], 'a clip showing source 3 s to 13 s, placed at frame 30');
    assert.deepEqual(cutsToTimelineFrames(clip({ in: 0, len: 300 }), 0, cuts), [120, 240], 'a cut past the end of the clip is dropped');
});

test('cuts on the first or last frame are dropped and repeated frames count once', () => {
    const c = clip({ in: 30, len: 120 });
    assert.deepEqual(cutsToTimelineFrames(c, 0, [{ time: 1 }, { time: 5 }, { time: 2 }, { time: 2.01 }]), [30]);
    assert.deepEqual(cutsToTimelineFrames(c, 0, []), []);
});

test('hard cuts and possible dissolves are separated, and anything that is not hard is only possible', () => {
    const { hard, possible } = partitionCuts([{ kind: 'hard', time: 1 }, { kind: 'gradual', time: 2 }, { kind: 'hard', time: 3 }, { time: 4 }]);
    assert.deepEqual(hard.map(c => c.time), [1, 3]);
    assert.deepEqual(possible.map(c => c.time), [2, 4]);
});

test('the scenes flag is off unless the grouped value says true, and closed in the shipped config', () => {
    const on = { EDITOR_RUNTIME_FLAGS: JSON.stringify({ scenes: 'true' }) };
    assert.equal(editorFeatureEnabled('EDITOR_SCENES_ENABLED', on), true);
    assert.equal(editorFeatureEnabled('EDITOR_SCENES_ENABLED', { EDITOR_RUNTIME_FLAGS: JSON.stringify({ scenes: 'false' }) }), false);
    assert.equal(editorFeatureEnabled('EDITOR_SCENES_ENABLED', { EDITOR_RUNTIME_FLAGS: JSON.stringify({ scenes: true }) }), false);
    assert.equal(editorFeatureEnabled('EDITOR_SCENES_ENABLED', { ...on, EDITOR_SCENES_ENABLED: 'false' }), false, 'a legacy false still rolls it back');
    assert.equal(editorFeatureEnabled('EDITOR_SCENES_ENABLED', {}), false);
    const config = parseJsonc(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
    assert.equal(editorFeatureEnabled('EDITOR_SCENES_ENABLED', config.vars), false);
    assert.equal(editorFeatureEnabled('EDITOR_SCENES_ENABLED', config.env.staging.vars), false);
});

import { checkSequenceClipForScenes, sceneRows, tickedFrames } from '../app/veyrnox/_lib/editorSceneRun.mjs';

test('a multitrack clip must run its source at normal speed before scenes are detected', () => {
    const item = { id: 'v1', in: 0, start: 0, len: 300 };
    assert.equal(checkSequenceClipForScenes(media(), item), null);
    for (const over of [{ rate: 2 }, { reverse: true }, { speedCurve: [{ frame: 0, rate: 1 }] }, { freezeFrame: 4 }]) {
        assert.match(checkSequenceClipForScenes(media(), { ...item, ...over }), /Reset speed/);
    }
    assert.equal(checkSequenceClipForScenes(media(), { ...item, rate: 1 }), null);
    assert.match(checkSequenceClipForScenes(media(), null), /Select a video clip/);
    assert.match(checkSequenceClipForScenes(media({ width: 1920, height: 1080 }), item), /720p/);
});

test('rows place each cut on the timeline, tick hard cuts only, and add all means the ticked ones', () => {
    const item = { id: 'v1', in: 60, start: 90, len: 300 };
    const rows = sceneRows(item, [{ time: 4, kind: 'hard' }, { time: 8.5, kind: 'gradual' }, { time: 2, kind: 'hard' }, { time: 4.01, kind: 'hard' }, { time: 40, kind: 'hard' }]);
    assert.deepEqual(rows.map(r => [r.frame, r.kind, r.ticked]), [[150, 'hard', true], [285, 'possible', false]]);
    assert.deepEqual(tickedFrames(rows), [150]);
    assert.deepEqual(tickedFrames(rows.map(r => ({ ...r, ticked: true }))), [150, 285]);
    assert.deepEqual(sceneRows(item, []), []);
});

test('the clipper flag is off unless the grouped value says true, independent of scenes, and closed in the shipped config', () => {
    const only = key => ({ EDITOR_RUNTIME_FLAGS: JSON.stringify({ [key]: 'true' }) });
    assert.equal(editorFeatureEnabled('EDITOR_CLIPPER_ENABLED', only('clipper')), true);
    assert.equal(editorFeatureEnabled('EDITOR_SCENES_ENABLED', only('clipper')), false);
    assert.equal(editorFeatureEnabled('EDITOR_CLIPPER_ENABLED', only('scenes')), false);
    assert.equal(editorFeatureEnabled('EDITOR_CLIPPER_ENABLED', { ...only('clipper'), EDITOR_CLIPPER_ENABLED: 'false' }), false);
    const config = parseJsonc(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
    assert.equal(editorFeatureEnabled('EDITOR_CLIPPER_ENABLED', config.vars), false);
    assert.equal(editorFeatureEnabled('EDITOR_CLIPPER_ENABLED', config.env.staging.vars), false);
});

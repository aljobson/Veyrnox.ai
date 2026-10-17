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

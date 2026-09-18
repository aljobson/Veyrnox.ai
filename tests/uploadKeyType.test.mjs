import test from 'node:test';
import assert from 'node:assert/strict';
import { typeForKey, uploadKeyFor } from '../lib/uploadSource.js';
import { kindOf } from '../app/veyrnox/_lib/tokens.js';

const AUTH = '11111111-2222-3333-4444-555555555555';
const UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

test('the key records which provider input the source becomes', () => {
    assert.deepEqual(typeForKey(uploadKeyFor(AUTH, 'image/png', UUID).key), { contentType: 'image/png', field: 'image_url' });
    assert.deepEqual(typeForKey(uploadKeyFor(AUTH, 'image/jpeg', UUID).key), { contentType: 'image/jpeg', field: 'image_url' });
    assert.deepEqual(typeForKey(uploadKeyFor(AUTH, 'image/webp', UUID).key), { contentType: 'image/webp', field: 'image_url' });
    assert.deepEqual(typeForKey(uploadKeyFor(AUTH, 'video/mp4', UUID).key), { contentType: 'video/mp4', field: 'video_url' });
});

test('a key this module did not mint describes nothing', () => {
    for (const bad of [`uploads/${AUTH}/${UUID}.exe`, `results/${AUTH}/${UUID}.png`, 'uploads/x/y.png', '', null, `uploads/${AUTH}/${UUID}.png/../evil.png`]) {
        assert.equal(typeForKey(bad), null, `${bad} must describe nothing`);
    }
});

// The catalog's modality strings decide how the UI groups a model and how the
// gateway prices it. Filters introduce two the catalog has never held, so pin
// the behaviour before a catalog row depends on it.
test('transform modalities bucket the way the filters need', () => {
    assert.equal(kindOf('image-to-image'), 'image');
    assert.equal(kindOf('video-to-video'), 'video');
    // Unchanged for everything already in the catalog.
    assert.equal(kindOf('text-to-image'), 'image');
    assert.equal(kindOf('image-to-video'), 'video');
    assert.equal(kindOf('text-to-video'), 'video');
    assert.equal(kindOf('text-to-audio'), 'audio');
    assert.equal(kindOf('text-to-speech'), 'audio');
    // A modality nobody has seen must never earn the video price multiplier.
    assert.equal(kindOf('image-to-3d'), 'image');
    assert.equal(kindOf(''), 'image');
    assert.equal(kindOf(undefined), 'image');
});

// priceFor is not exported from the route, so this mirrors its one rule:
// modality.endsWith('video') buys per 5-second unit, everything else is one
// unit per output. A video filter must be priced per unit like any clip.
test('a transform modality prices the same way its bucket implies', () => {
    const isVideo = (m) => typeof m === 'string' && m.endsWith('video');
    assert.equal(isVideo('video-to-video'), true, 'a video filter is priced per 5s unit');
    assert.equal(isVideo('image-to-image'), false, 'an image filter is one unit per output');
    // The two agree with kindOf, which is what keeps the UI's cost preview
    // and the server's charge from disagreeing.
    for (const m of ['image-to-image', 'video-to-video', 'text-to-video', 'image-to-video', 'text-to-image']) {
        assert.equal(isVideo(m), kindOf(m) === 'video', `${m} must price the way it is grouped`);
    }
});

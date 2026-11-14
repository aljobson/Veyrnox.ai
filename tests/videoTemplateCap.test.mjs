// Template caps (owner decision, 2026-11-14): at most 100 templates per type, and every listed video
// template uses the person's own photo (@image1, @image2, ...) and can generate today. Audio is the 87 licensed
// tracks plus 13 Music Discover samples; image is the 55 listed today, unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import { GALLERY_PRESETS as PRESETS, ALL_TEMPLATES, galleryTemplates, templateById } from '../app/veyrnox/_lib/templates.js';
import { VIDEO_TEMPLATE_CAP, VIDEO_GALLERY_TEMPLATE_IDS } from '../app/veyrnox/_lib/videoTemplateGallery.js';
import { IMAGE_TEMPLATES } from '../app/veyrnox/_lib/imageTemplates.js';
import { createTemplatesFor } from '../app/veyrnox/_lib/createTemplates.js';
import { MUSIC_DISCOVER_BEATS, MUSIC_DISCOVER_LISTED_BEATS, getMusicDiscoverSeed } from '../lib/musicDiscover.js';
import { LICENSED_MUSIC_TRACKS } from '../lib/licensedMusicCatalog.js';
import { templateCards, templateDetail } from '../lib/clientTemplates.js';
import { toPublicPresets } from '../lib/publicPresets.js';
import { templateSourceUnsupported } from '../app/veyrnox/_lib/templateSourceBlock.js';

const CAP = 100;
const IMAGE_REF = /@image\d*/i;
const VIDEO_REF = /@video\d*/i;

test('the video cap is 100 and the keep list is unique and within it', () => {
    assert.equal(VIDEO_TEMPLATE_CAP, CAP);
    assert.ok(VIDEO_GALLERY_TEMPLATE_IDS.length <= CAP);
    assert.equal(new Set(VIDEO_GALLERY_TEMPLATE_IDS).size, VIDEO_GALLERY_TEMPLATE_IDS.length);
});

test('the video gallery lists exactly the keep list, at most 100', () => {
    assert.ok(PRESETS.length <= CAP, `${PRESETS.length} video templates listed`);
    assert.deepEqual(new Set(PRESETS.map((p) => p.id)), new Set(VIDEO_GALLERY_TEMPLATE_IDS),
        'every kept id is a published template with a preview video');
    const videoCards = templateCards().filter((card) => card.kind !== 'image');
    assert.ok(videoCards.length <= CAP);
    assert.ok(videoCards.every((card) => VIDEO_GALLERY_TEMPLATE_IDS.includes(card.id)));
    const listedVideo = galleryTemplates().filter((t) => t.kind !== 'image');
    assert.ok(listedVideo.length <= CAP);
});

test('every listed video template uses the person\'s photo, no @video, and can generate', () => {
    for (const preset of PRESETS) {
        const detail = templateDetail(preset.id);
        assert.match(detail.prompt, IMAGE_REF, `${preset.id} refers to @image`);
        assert.doesNotMatch(detail.prompt, VIDEO_REF, `${preset.id} needs a source video we cannot supply`);
        assert.equal(templateSourceUnsupported(detail), false, `${preset.id} is blocked from generating`);
    }
});

test('/api/presets (the mobile gallery) lists only the capped video templates', () => {
    const presets = toPublicPresets([]);
    assert.ok(presets.length <= CAP);
    assert.ok(presets.every((p) => VIDEO_GALLERY_TEMPLATE_IDS.includes(p.id)));
});

test('Create lists no video starts: none of them used the person\'s photo', () => {
    assert.equal(createTemplatesFor('video').length, 0);
});

test('image stays at 55 and within 100', () => {
    const image = IMAGE_TEMPLATES.length + createTemplatesFor('image').length;
    assert.equal(image, 55);
});

test('audio lists at most 100: all licensed tracks plus the first 13 "For you" Discover samples', () => {
    const create = createTemplatesFor('audio');
    assert.ok(create.every((t) => LICENSED_MUSIC_TRACKS.some((track) => track.id === t.licensedTrackId)), 'Create audio starts are licensed tracks');
    assert.equal(MUSIC_DISCOVER_LISTED_BEATS.length, 13);
    assert.deepEqual(MUSIC_DISCOVER_LISTED_BEATS, MUSIC_DISCOVER_BEATS.filter((b) => b.section === 'For you').slice(0, 13));
    const audio = LICENSED_MUSIC_TRACKS.length + MUSIC_DISCOVER_LISTED_BEATS.length;
    assert.ok(audio <= CAP, `${audio} audio templates listed`);
    const hidden = MUSIC_DISCOVER_BEATS.find((b) => !MUSIC_DISCOVER_LISTED_BEATS.includes(b));
    assert.equal(getMusicDiscoverSeed(hidden.id), hidden, 'a hidden sample still opens from a saved mix or link');
});

test('a hidden template still resolves by its direct link', () => {
    const hidden = ALL_TEMPLATES.find((t) => !VIDEO_GALLERY_TEMPLATE_IDS.includes(t.id));
    assert.ok(hidden);
    assert.equal(templateById(hidden.id)?.id, hidden.id);
});

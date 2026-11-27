// Template caps (owner decisions): 100 per type on 2026-11-14; video and image raised to 150 on 2026-11-15, audio
// stays at 100. Every listed video template uses the person's own photo and can generate today, and every listed
// video and image prompt is English (2026-11-15). Audio is the 87 licensed tracks plus 13 Music Discover samples.
import test from 'node:test';
import assert from 'node:assert/strict';
import { GALLERY_PRESETS as PRESETS, ALL_TEMPLATES, galleryTemplates, templateById } from '../app/veyrnox/_lib/templates.js';
import { VIDEO_TEMPLATE_CAP, VIDEO_GALLERY_TEMPLATE_IDS, TESTED_SWAP_GALLERY_TEMPLATE_IDS } from '../app/veyrnox/_lib/videoTemplateGallery.js';
import { publishedImageTemplates } from '../app/veyrnox/_lib/imageTemplates.js';
import { isEnglishPrompt } from '../scripts/lib/english-prompt.mjs';
import { createTemplatesFor } from '../app/veyrnox/_lib/createTemplates.js';
import { MUSIC_DISCOVER_BEATS, MUSIC_DISCOVER_LISTED_BEATS, getMusicDiscoverSeed } from '../lib/musicDiscover.js';
import { LICENSED_MUSIC_TRACKS } from '../lib/licensedMusicCatalog.js';
import { templateCards, templateDetail } from '../lib/clientTemplates.js';
import { toPublicPresets } from '../lib/publicPresets.js';
import { templateSourceUnsupported } from '../app/veyrnox/_lib/templateSourceBlock.js';
import { imageSlots } from '../lib/templateBinding.js';
import { templateContract } from '../lib/templateContract.js';
import { swapNeedsSourceVideo } from '../lib/templateSwapGuard.js';
import { TEMPLATE_SWAP_CLIPS } from '../app/veyrnox/_lib/templateSwapClips.js';
import { effectiveSwapRole } from '../lib/templateSwapRoleOverrides.mjs';

const CAP = 150, IMAGE_CAP = 150, AUDIO_CAP = 100;
const PHOTO_ROUTE_PRESETS = PRESETS.filter((preset) => !TESTED_SWAP_GALLERY_TEMPLATE_IDS.includes(preset.id));
const VIDEO_REF = /@video\d*/i;
const MULTI_PHOTO_EXCLUSIONS = Object.freeze([
    'community-spinning-wardrobe-swap',
    'community-supercar-driver-swap',
    'community-sunlit-bedroom-dance',
]);

test('the video cap is 150 and the keep list is unique and within it', () => {
    assert.equal(VIDEO_TEMPLATE_CAP, CAP);
    assert.ok(VIDEO_GALLERY_TEMPLATE_IDS.length <= CAP);
    assert.equal(new Set(VIDEO_GALLERY_TEMPLATE_IDS).size, VIDEO_GALLERY_TEMPLATE_IDS.length);
});

test('the video gallery lists exactly the keep list, at most 150', () => {
    assert.ok(PRESETS.length <= CAP, `${PRESETS.length} video templates listed`);
    assert.deepEqual(new Set(PRESETS.map((p) => p.id)), new Set(VIDEO_GALLERY_TEMPLATE_IDS),
        'every kept id is a published template with a preview video');
    const videoCards = templateCards().filter((card) => card.kind !== 'image');
    assert.ok(videoCards.length <= CAP);
    assert.ok(videoCards.every((card) => VIDEO_GALLERY_TEMPLATE_IDS.includes(card.id)));
    const listedVideo = galleryTemplates().filter((t) => t.kind !== 'image');
    assert.ok(listedVideo.length <= CAP);
});

test('every listed video template binds the person\'s photo, needs no @video, and can generate', () => {
    for (const preset of PHOTO_ROUTE_PRESETS) {
        const detail = templateDetail(preset.id);
        const citedSlots = imageSlots(detail.prompt);
        assert.ok(citedSlots.length >= 1, `${preset.id} refers to the person's photo`);
        assert.doesNotMatch(detail.prompt, VIDEO_REF, `${preset.id} needs a source video we cannot supply`);
        assert.equal(templateSourceUnsupported(detail), false, `${preset.id} is blocked from generating`);
        // The contract binds the cited photo to an upload slot the model really has (audit 2026-11-15: a prompt
        // that cites photos with no slot cannot take the person's upload).
        assert.equal(detail.fidelity?.class, 'bound', `${preset.id} has no slot for the photo its prompt cites`);
        assert.ok(detail.fidelity.slotCount >= 1, preset.id);
        assert.equal(citedSlots.length, detail.fidelity.slotCount,
            `${preset.id} cites a different number of photos than its model accepts`);
    }
});

test('no listed video template is a swap recipe the server refuses before charging', () => {
    // A swap recipe ("Replace X in the video with <<<image_1>>>") needs the template's own source clip. The generations
    // route answers template_blocked for it (lib/templateFidelity.js), so listing it only shows people an error.
    const refused = PHOTO_ROUTE_PRESETS.filter((preset) => {
        const contract = templateContract(preset.id);
        return contract && swapNeedsSourceVideo(contract.sourcePrompt);
    }).map((preset) => preset.id);
    assert.deepEqual(refused, []);
});

test('every tested swap template is a registered clip with a reviewed role, so it runs on the swap path', () => {
    assert.equal(TESTED_SWAP_GALLERY_TEMPLATE_IDS.length, 51);
    for (const id of TESTED_SWAP_GALLERY_TEMPLATE_IDS) {
        assert.ok(VIDEO_GALLERY_TEMPLATE_IDS.includes(id), id);
        assert.ok(TEMPLATE_SWAP_CLIPS.includes(id), id);
        assert.notEqual(effectiveSwapRole(id, 'the main character'), 'the main character', id);
    }
});

test('the three audited multi-photo templates stay hidden but keep resolving by direct link', () => {
    for (const id of MULTI_PHOTO_EXCLUSIONS) {
        assert.equal(VIDEO_GALLERY_TEMPLATE_IDS.includes(id), false, `${id} needs more photos than its one slot accepts`);
        assert.equal(templateById(id)?.id, id, `${id} still resolves from a saved or direct link`);
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

test('every listed video prompt is English', () => {
    for (const preset of PHOTO_ROUTE_PRESETS) assert.ok(isEnglishPrompt(templateDetail(preset.id).prompt), preset.id + ' is not English');
});

test('images list at most 150, every prompt English', () => {
    const previous = process.env.IMAGE_TEMPLATES_ENABLED;
    process.env.IMAGE_TEMPLATES_ENABLED = 'true';
    try {
        const listed = [...publishedImageTemplates(), ...createTemplatesFor('image')];
        assert.ok(listed.length <= IMAGE_CAP, listed.length + ' image templates listed');
        assert.equal(listed.length, 93);
        for (const t of listed) assert.ok(isEnglishPrompt(t.prompt), t.id + ' is not English');
    } finally {
        if (previous === undefined) delete process.env.IMAGE_TEMPLATES_ENABLED; else process.env.IMAGE_TEMPLATES_ENABLED = previous;
    }
});

test('audio lists at most 100: active Sound Effects starts, licensed tracks and the first seven "For you" samples', () => {
    const create = createTemplatesFor('audio');
    assert.ok(create.every((t) => t.model === 'Suno Sound Effects' && t.category === 'SOUND FX'), 'Create audio starts use the active Sound Effects model');
    assert.equal(MUSIC_DISCOVER_LISTED_BEATS.length, 7);
    assert.deepEqual(MUSIC_DISCOVER_LISTED_BEATS, MUSIC_DISCOVER_BEATS.filter((b) => b.section === 'For you').slice(0, 7));
    const audio = create.length + LICENSED_MUSIC_TRACKS.length + MUSIC_DISCOVER_LISTED_BEATS.length;
    assert.ok(audio <= AUDIO_CAP, `${audio} audio templates listed`);
    const hidden = MUSIC_DISCOVER_BEATS.find((b) => !MUSIC_DISCOVER_LISTED_BEATS.includes(b));
    assert.equal(getMusicDiscoverSeed(hidden.id), hidden, 'a hidden sample still opens from a saved mix or link');
});

test('a hidden template still resolves by its direct link', () => {
    const hidden = ALL_TEMPLATES.find((t) => !VIDEO_GALLERY_TEMPLATE_IDS.includes(t.id));
    assert.ok(hidden);
    assert.equal(templateById(hidden.id)?.id, hidden.id);
});

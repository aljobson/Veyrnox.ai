// Duplicate video templates (owner request, 2026-11-17): templates whose prompt and preview scene are the same
// leave every public surface and the old direct link redirects to the kept template. Same mechanism family as
// brokenTemplateIds.js, but a withdrawn duplicate has a keeper to land on.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DUPLICATE_TEMPLATE_KEEPERS, duplicateKeeperId } from '../app/veyrnox/_lib/duplicateTemplateIds.js';
import { BROKEN_TEMPLATE_IDS } from '../app/veyrnox/_lib/brokenTemplateIds.js';
import { VIDEO_GALLERY_TEMPLATE_IDS } from '../app/veyrnox/_lib/videoTemplateGallery.js';
import { ALL_TEMPLATES, GALLERY_PRESETS, galleryTemplates, searchTemplates, templateById } from '../app/veyrnox/_lib/templates.js';
import { SOURCE_TEMPLATES } from '../app/veyrnox/_lib/sourceTemplates.js';
import { isUnknownStaticPage } from '../lib/unknownStaticPage.js';
import { toPublicPresets } from '../lib/publicPresets.js';
import { templateCards } from '../lib/clientTemplates.js';

const entries = Object.entries(DUPLICATE_TEMPLATE_KEEPERS);
const sourceIds = new Set(SOURCE_TEMPLATES.map((t) => t.id));

test('the map is frozen, has 13 withdrawn ids, and never chains or loops', () => {
    assert.ok(Object.isFrozen(DUPLICATE_TEMPLATE_KEEPERS));
    assert.equal(entries.length, 13);
    for (const [dup, keeper] of entries) {
        assert.notEqual(dup, keeper);
        assert.equal(Object.hasOwn(DUPLICATE_TEMPLATE_KEEPERS, keeper), false, `${dup} -> ${keeper} chains`);
    }
});

test('every duplicate is a real template and every keeper still publishes', () => {
    for (const [dup, keeper] of entries) {
        assert.ok(sourceIds.has(dup), `${dup} is not a known template id`);
        assert.ok(ALL_TEMPLATES.some((t) => t.id === keeper), `${keeper} (keeper of ${dup}) is not published`);
        assert.equal(BROKEN_TEMPLATE_IDS.includes(dup) || BROKEN_TEMPLATE_IDS.includes(keeper), false, `${dup}/${keeper} is withdrawn as broken`);
    }
});

test('a withdrawn duplicate is in no public list: gallery, search, /api/templates, /api/presets', () => {
    const dups = new Set(Object.keys(DUPLICATE_TEMPLATE_KEEPERS));
    for (const list of [GALLERY_PRESETS, galleryTemplates(), toPublicPresets([]), templateCards()]) {
        assert.deepEqual(list.filter((t) => dups.has(t.id)).map((t) => t.id), []);
    }
    assert.equal(VIDEO_GALLERY_TEMPLATE_IDS.some((id) => dups.has(id)), false);
    for (const [dup] of entries) {
        const words = dup.replaceAll('-', ' ');
        assert.equal(searchTemplates(galleryTemplates(), words).some((t) => t.id === dup), false, `${dup} still turns up in search`);
    }
});

test('an old link redirects to the keeper and is never a hard 404', () => {
    for (const [dup, keeper] of entries) {
        assert.equal(duplicateKeeperId(dup), keeper, dup);
        assert.equal(templateById(keeper)?.id, keeper);
        assert.equal(isUnknownStaticPage(`/presets/${dup}`), false, `${dup} would answer a hard 404`);
    }
    assert.equal(duplicateKeeperId('no-such-template'), null);
    assert.equal(duplicateKeeperId('toString'), null);
    const page = readFileSync(new URL('../app/veyrnox/presets/[id]/page.js', import.meta.url), 'utf8');
    assert.match(page, /duplicateKeeperId\(publicTemplateId\(id\)\)[\s\S]{0,120}permanentRedirect/);
});

test('a keeper that sat in the gallery stays in it, and nothing is backfilled', () => {
    for (const keeper of new Set(Object.values(DUPLICATE_TEMPLATE_KEEPERS))) {
        const inGallery = VIDEO_GALLERY_TEMPLATE_IDS.includes(keeper);
        assert.equal(GALLERY_PRESETS.some((t) => t.id === keeper), inGallery);
    }
    assert.equal(VIDEO_GALLERY_TEMPLATE_IDS.length, 149, '150 minus the one gallery duplicate removed (community-midnight-fridge-feast)');
});

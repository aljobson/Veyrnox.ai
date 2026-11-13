import test from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS, PRESET_CATEGORIES, templatesIn } from '../app/veyrnox/_lib/templates.js';
import { exactSourcePromptRecord } from '../app/veyrnox/_lib/sourcePromptRecords.js';
import { SOURCE_TEMPLATES } from '../app/veyrnox/_lib/sourceTemplates.js';

test('all twelve required content categories are present with at least ten public exact templates', () => {
    // Fixed owner-approved list: a disappearing category must fail this test.
    const required = ['YOUR PHOTO', 'CINEMATIC', 'ANIME', 'CARTOONS', 'MOVIES', 'FANTASY', 'REALISTIC', 'FASHION', 'PRODUCTS', 'VFX', 'UGC', 'ADS'];
    for (const category of required) {
        assert.ok(PRESET_CATEGORIES.includes(category), category);
        const rows = templatesIn(category);
        assert.ok(rows.length >= 10, category + ': ' + rows.length);
        for (const row of rows) {
            assert.equal(row.prompt, exactSourcePromptRecord(row.id).prompt, row.id);
            assert.equal(row.sourcePrompt, row.prompt, row.id);
            assert.equal(row.promptOrigin, 'community-source-exact', row.id);
        }
    }
    assert.equal(templatesIn('ANIME').length, 12);
    assert.equal(templatesIn('ADS').length, 16);
    assert.equal(templatesIn('YOUR PHOTO').length, 13);
});

test('KIDS BIRTHDAY remains an explicit exclusion pending an owner decision', () => {
    // Pending: all twelve retained rows lack a captured community prompt.
    // Do not remove CATEGORY_ORDER membership or invent replacement records.
    const ids = ['birthday-rocket-launch', 'candle-wish-world', 'giant-age-adventure', 'dinosaur-birthday-parade', 'underwater-birthday-kingdom', 'toybox-comes-alive', 'monster-disco-party', 'mini-cake-chef', 'birthday-news-report', 'party-invitation-trailer', 'growing-up-timeline', 'birthday-highlight-reel'];
    assert.deepEqual(SOURCE_TEMPLATES.filter(t => t.category === 'KIDS BIRTHDAY').map(t => t.id).sort(), ids.sort());
    assert.equal(templatesIn('KIDS BIRTHDAY').length, 0);
    assert.equal(PRESET_CATEGORIES.includes('KIDS BIRTHDAY'), false);
    for (const row of SOURCE_TEMPLATES.filter(t => t.category === 'KIDS BIRTHDAY')) {
        assert.equal(row.prompt, null, row.id);
        assert.equal(row.sourcePrompt, null, row.id);
    }
});

test('the Trends categories from ADR-0072 are in the filter', () => {
    for (const c of ['CARTOONS', 'MOVIES', 'FANTASY', 'REALISTIC']) assert.ok(PRESET_CATEGORIES.includes(c), c);
});

test('every real category has at least one template, so no filter shows an empty page', () => {
    for (const c of PRESET_CATEGORIES.filter((c) => c !== 'ALL' && c !== 'NEW')) {
        assert.ok(templatesIn(c).length >= 1, `${c} has no template`);
    }
});

test('every template belongs to a listed category, with a unique id and a non-empty prompt', () => {
    const ids = new Set();
    for (const p of PRESETS) {
        assert.ok(PRESET_CATEGORIES.includes(p.category), `${p.id}: ${p.category}`);
        assert.ok(!ids.has(p.id), `duplicate id ${p.id}`);
        ids.add(p.id);
        // Authentic source text can be short, including Korean and Arabic records.
        // Never pad a captured prompt to satisfy the old adaptation length floor.
        assert.ok(typeof p.prompt === 'string' && p.prompt.trim().length > 0, p.id);
        assert.equal(p.prompt, exactSourcePromptRecord(p.id).prompt, p.id);
    }
});

test('the new templates are flagged New and sit in their own category as well', () => {
    for (const [id, category] of [['community-biker-dog-adventure', 'CARTOONS'], ['epic-train-doorway-scene', 'MOVIES'], ['dreamworks-castle', 'FANTASY'], ['community-parking-lot-recast', 'REALISTIC']]) {
        const p = PRESETS.find((x) => x.id === id);
        assert.ok(p && p.isNew && p.category === category, id);
        assert.ok(templatesIn('NEW').includes(p) && templatesIn(category).includes(p), id);
    }
});

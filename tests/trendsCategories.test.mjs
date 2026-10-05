import test from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS, PRESET_CATEGORIES, templatesIn } from '../app/veyrnox/_lib/templates.js';

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
        assert.ok(typeof p.prompt === 'string' && p.prompt.trim().length > 20, p.id);
    }
});

test('the new templates are flagged New and sit in their own category as well', () => {
    for (const [id, category] of [['saturday-cartoon', 'CARTOONS'], ['noir-one-sheet', 'MOVIES'], ['floating-castle', 'FANTASY'], ['street-portrait', 'REALISTIC']]) {
        const p = PRESETS.find((x) => x.id === id);
        assert.ok(p && p.isNew && p.category === category, id);
        assert.ok(templatesIn('NEW').includes(p) && templatesIn(category).includes(p), id);
    }
});

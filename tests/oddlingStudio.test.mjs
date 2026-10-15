import test from 'node:test';
import assert from 'node:assert/strict';
import { CHARACTER_GROUPS, ODDLING_ARCHETYPES } from '../app/veyrnox/_lib/character.js';
import {
    ODDLING_MOTIONS,
    ODDLING_STUDIO_SECTIONS,
    buildOddlingStudioPrompt,
    gallerySource,
    randomizeOddlingStyle,
    readOddlingLibrary,
    saveOddlingToLibrary,
} from '../app/veyrnox/_lib/oddlingStudio.js';

test('every full-studio section resolves to real character groups', () => {
    const ids = new Set(CHARACTER_GROUPS.map((group) => group.id));
    assert.equal(ODDLING_STUDIO_SECTIONS.length, 8);
    for (const section of ODDLING_STUDIO_SECTIONS) {
        assert.ok(section.groupIds.length > 0);
        for (const id of section.groupIds) assert.ok(ids.has(id), `${section.id} references missing ${id}`);
    }
});
test('motion drafts combine identity, visual canon, action and scene', () => {
    const picks = ODDLING_ARCHETYPES.find((item) => item.id === 'bughead-brenda').picks;
    const prompt = buildOddlingStudioPrompt({
        picks,
        mode: 'motion',
        motionId: 'prop-malfunction',
        scene: 'standing in a tiny etiquette classroom',
        referenceNote: 'borrow only the orange and blue palette',
    });
    assert.match(prompt, /original adult character, not a real person/);
    assert.match(prompt, /Bughead Brenda/);
    assert.match(prompt, /wearable mask/);
    assert.match(prompt, /harmlessly malfunctions/);
    assert.match(prompt, /orange and blue palette/);
    assert.match(prompt, /tiny etiquette classroom/);
});

test('randomize styling preserves deliberate body and identity choices', () => {
    const picks = {
        character_type: 'Human', gender: 'Female', body_type: 'Very Skinny', height: 'Very Tall',
        oddling_name: 'Long Division', oddling_obsession: 'door frames', hair: 'Cube Cut',
    };
    const randomized = randomizeOddlingStyle(picks, () => 0);
    assert.equal(randomized.character_type, 'Human');
    assert.equal(randomized.gender, 'Female');
    assert.equal(randomized.body_type, 'Very Skinny');
    assert.equal(randomized.height, 'Very Tall');
    assert.equal(randomized.oddling_name, 'Long Division');
    assert.equal(randomized.hair, 'Bald');
});

test('local History stores bounded sanitized passports newest first', () => {
    const map = new Map();
    const storage = { getItem: (key) => map.get(key) ?? null, setItem: (key, value) => map.set(key, value) };
    assert.equal(saveOddlingToLibrary(storage, { oddling_name: 'First', body_type: 'Fat', unknown: 'drop' }, ODDLING_MOTIONS[0].id, 100).ok, true);
    assert.equal(saveOddlingToLibrary(storage, { oddling_name: 'Second', hair: 'Cube Cut' }, 'not-a-motion', 200).ok, true);
    const history = readOddlingLibrary(storage);
    assert.equal(history.length, 2);
    assert.equal(history[0].name, 'Second');
    assert.equal(history[0].motionId, '');
    assert.equal(history[0].picks.unknown, undefined);
    assert.equal(history[1].picks.body_type, 'Fat');
});

test('gallery art maps every original character to a four-panel cast asset', () => {
    for (const oddling of ODDLING_ARCHETYPES) {
        const source = gallerySource(oddling);
        assert.match(source.image, /^\/oddlings\/oddling-.+\.webp$/);
        assert.ok(source.panel >= 0 && source.panel <= 3);
    }
});

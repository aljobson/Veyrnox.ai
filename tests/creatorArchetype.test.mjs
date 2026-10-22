import test from 'node:test';
import assert from 'node:assert/strict';
import { CREATOR_ANSWERS, CHAOS_MAX } from '../lib/creatorProfile.js';
import {
    archetypeName, creatorCard, chaosBand, PACE_NOUNS, CHAOS_ADJECTIVES, LOOK_LABELS, DESTINATION_LABELS, CHAOS_LABELS,
} from '../lib/creatorArchetype.js';

const good = { look: 'neon_rain', goal: 'story', pace: 'octopus', chaos: 2, destination: 'tiktok', audience: 'me', voice: 'calm' };

test('the twelve pace and chaos combinations give twelve different names', () => {
    const names = new Set();
    for (const pace of CREATOR_ANSWERS.pace) for (let chaos = 0; chaos <= CHAOS_MAX; chaos++) names.add(archetypeName({ ...good, pace, chaos }));
    assert.equal(names.size, 12);
    assert.equal(archetypeName({ ...good, pace: 'octopus', chaos: 2 }), 'The Midnight Tinkerer');
    assert.equal(archetypeName({ ...good, pace: 'fox', chaos: 0 }), 'The Careful Firestarter');
    assert.equal(archetypeName({ ...good, pace: 'jellyfish', chaos: 4 }), 'The Feral Dreamer');
});

test('the chaos bands are 0-1, 2 and 3-4', () => {
    assert.deepEqual([0, 1, 2, 3, 4].map(chaosBand), [0, 0, 1, 2, 2]);
});

test('same answers, same card; other answers (goal, voice, audience) do not change it', () => {
    const a = creatorCard(good);
    assert.deepEqual(creatorCard({ ...good }), a);
    assert.deepEqual(creatorCard({ ...good, goal: 'meme', voice: 'hype', audience: 'kids' }), a);
    assert.notDeepEqual(creatorCard({ ...good, look: 'doc_grit' }), a);
});

test('every allowlisted value has a name, label or noun, so no valid answer set breaks the card', () => {
    assert.deepEqual(Object.keys(PACE_NOUNS).sort(), [...CREATOR_ANSWERS.pace].sort());
    assert.deepEqual(Object.keys(LOOK_LABELS).sort(), [...CREATOR_ANSWERS.look].sort());
    assert.deepEqual(Object.keys(DESTINATION_LABELS).sort(), [...CREATOR_ANSWERS.destination].sort());
    assert.equal(CHAOS_LABELS.length, CHAOS_MAX + 1);
    assert.equal(CHAOS_ADJECTIVES.length, 3);
});

test('the card carries the studio name only when there is one, and three traits', () => {
    assert.equal(creatorCard(good).studio, null);
    assert.equal(creatorCard({ ...good, studio_name: '  Night Owl Films ' }).studio, 'Night Owl Films');
    assert.equal(creatorCard({ ...good, studio_name: '   ' }).studio, null);
    assert.deepEqual(creatorCard(good).traits, ['Neon rain', 'A little odd', 'TikTok']);
});

test('answers from another version never throw: unknown values fall back, prototype keys are not read', () => {
    for (const bad of [undefined, null, 5, 'x', [], {}, { pace: '__proto__', chaos: 99, look: 'constructor', destination: 'toString' }]) {
        const card = creatorCard(bad);
        assert.match(card.name, /^The (Careful|Midnight|Feral) \w+$/);
        assert.ok(Array.isArray(card.traits));
    }
    assert.equal(archetypeName({}), 'The Midnight Maker');
    assert.equal(archetypeName({ pace: 'constructor', chaos: 'x' }), 'The Midnight Maker');
    assert.deepEqual(creatorCard({ look: 'toString', destination: '__proto__' }).traits, ['A little odd']);
});

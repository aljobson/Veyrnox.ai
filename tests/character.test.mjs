import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildCharacterPrompt,
    characterTraits,
    oddlingIdentity,
    readOddlingDraft,
    sanitizeOddlingPicks,
    writeOddlingDraft,
    CHARACTER_BASE,
    CHARACTER_GROUPS,
    ODDLING_ARCHETYPES,
    ODDLING_DRAFT_KEY,
} from '../app/veyrnox/_lib/character.js';

test('the portrait always asks for an original adult, then the traits, then the user text', () => {
    const out = buildCharacterPrompt(' waving at the camera ', { gender: 'Female', rendering_style: 'Anime', horns: 'Antlers' });
    assert.ok(out.startsWith(CHARACTER_BASE));
    assert.match(CHARACTER_BASE, /original adult character, not a real person/);
    assert.ok(out.endsWith(', female, deer antlers on head, anime art style, waving at the camera'));
});

test('origin options use neutral heritage wording, not upstream\'s supermodel phrasing', () => {
    const origin = CHARACTER_GROUPS.find((g) => g.id === 'ethnicity_origin_base');
    for (const [, phrase] of origin.options) assert.doesNotMatch(phrase, /supermodel|idol|phenotype/i, phrase);
});

test('unknown picks add nothing, and the result fits the gateway limit', () => {
    assert.deepEqual(characterTraits({ gender: '<script>', nope: 'x' }), []);
    assert.equal(buildCharacterPrompt('', {}), CHARACTER_BASE);
    assert.equal(buildCharacterPrompt('x'.repeat(5000), { gender: 'Male' }).length, 2000);
});

test('Oddlings add a bounded creator identity and recurring show to the visual prompt', () => {
    const picks = {
        character_type: 'Moth', oddling_name: ' Auntie\nAntenna ',
        oddling_obsession: 'emotional weather', oddling_voice: 'Dry oracle',
        oddling_show: 'Impossible weather', oddling_rule: 'plum coat and copper antennae',
    };
    assert.deepEqual(oddlingIdentity(picks), [
        'fictional creator named Auntie Antenna',
        'obsessed with emotional weather',
        'deadpan, precise, faintly prophetic delivery',
        'reports emotional weather from places that cannot exist',
        'immutable visual canon: plum coat and copper antennae',
    ]);
    const prompt = buildCharacterPrompt('presenting a rainy forecast', picks);
    assert.match(prompt, /velvet moth humanoid/);
    assert.match(prompt, /fictional creator named Auntie Antenna/);
    assert.ok(prompt.endsWith('presenting a rainy forecast'));
});

test('Oddling starters lead with weird humans and retain an optional creature cast', () => {
    assert.equal(ODDLING_ARCHETYPES.length, 28);
    assert.equal(ODDLING_ARCHETYPES[0].kind, 'human');
    assert.equal(ODDLING_ARCHETYPES.filter((oddling) => oddling.kind === 'human').length, 24);
    assert.equal(ODDLING_ARCHETYPES.filter((oddling) => oddling.kind === 'creature').length, 4);
    for (const oddling of ODDLING_ARCHETYPES) {
        assert.equal(oddling.picks.oddling_name, oddling.name);
        assert.equal(oddling.picks.character_type === 'Human', oddling.kind === 'human');
        assert.match(buildCharacterPrompt('', oddling.picks), /original adult character, not a real person/);
        assert.deepEqual(sanitizeOddlingPicks(oddling.picks), oddling.picks, `${oddling.id} uses only builder-supported traits`);
    }
});

test('human starters cover intentionally different body silhouettes and wearable surrealism', () => {
    const byId = Object.fromEntries(ODDLING_ARCHETYPES.map((oddling) => [oddling.id, oddling]));
    assert.equal(byId['duchess-volume'].picks.body_type, 'Fat');
    assert.equal(byId['major-minor'].picks.body_type, 'Hyper-Muscular');
    assert.equal(byId['bughead-brenda'].picks.character_type, 'Human');
    assert.equal(byId['bughead-brenda'].picks.accessories, 'Bug Head Mask');
    assert.equal(byId['pam-bouffant'].picks.hair, 'Monumental Hair');
    assert.equal(byId['olive-orbit'].picks.body_type, 'Very Skinny');
    assert.equal(byId['brick-picnic'].picks.body_type, 'Barrel');
    assert.equal(byId['madame-scissors'].picks.body_type, 'Pear');
    assert.equal(byId['pocket-atlas'].picks.body_type, 'Hyper-Muscular');
    assert.equal(byId['taffy-tessa'].picks.body_type, 'Fat');
    assert.equal(byId['tuesday-triangle'].picks.body_type, 'Inverted Triangle');
    assert.equal(byId['colonel-crumb'].picks.body_type, 'Very Skinny');
    assert.equal(byId['baron-boucle'].picks.body_type, 'Fat');
    assert.equal(byId['tall-order'].picks.body_type, 'Very Skinny');
    assert.equal(byId['bubble-barry'].picks.body_type, 'Fat');
    assert.equal(byId['max-rep'].picks.body_type, 'Hyper-Muscular');
    assert.equal(byId['shelf-life'].picks.body_type, 'Pear');
    for (const id of ['duchess-volume', 'major-minor', 'bughead-brenda', 'pam-bouffant']) {
        assert.match(buildCharacterPrompt('', byId[id].picks), /original adult character, not a real person/);
    }
});

test('the builder offers graphic hair shapes and a broad, deliberate body vocabulary', () => {
    const bodies = CHARACTER_GROUPS.find((group) => group.id === 'body_type');
    const hair = CHARACTER_GROUPS.find((group) => group.id === 'hair');
    for (const label of ['Very Skinny', 'Lanky', 'Compact', 'Pear', 'Inverted Triangle', 'Barrel', 'Long Torso', 'Long Legs', 'Fat', 'Hyper-Muscular']) {
        assert.ok(bodies.options.some(([option]) => option === label), `missing body option: ${label}`);
    }
    for (const label of ['Cube Cut', 'Sphere Cut', 'Wedge Cut', 'Tabletop', 'Spiral Tower', 'Crescent Cut', 'Twin Discs', 'Zigzag Cut', 'Anvil Cut', 'Donut Halo', 'Tube Tower', 'Shelf Cut']) {
        assert.ok(hair.options.some(([option]) => option === label), `missing hair option: ${label}`);
    }
    const wardrobe = CHARACTER_GROUPS.find((group) => group.id === 'wardrobe_style');
    assert.ok(wardrobe.options.some(([option]) => option === 'Modern Basics'));
});

test('Oddling passports save only bounded known fields and survive blocked storage', () => {
    const map = new Map();
    const storage = { getItem: (key) => map.get(key) ?? null, setItem: (key, value) => map.set(key, value) };
    const picks = {
        character_type: 'Moth', oddling_name: `  Signal\n${'x'.repeat(80)}  `,
        oddling_voice: 'Dry oracle', oddling_show: '<script>', unknown: 'discard me',
    };
    assert.equal(writeOddlingDraft(storage, picks, 1234), true);
    assert.ok(map.has(ODDLING_DRAFT_KEY));
    const saved = readOddlingDraft(storage);
    assert.equal(saved.savedAt, 1234);
    assert.equal(saved.picks.character_type, 'Moth');
    assert.equal(saved.picks.oddling_name.length, 40);
    assert.equal(saved.picks.oddling_voice, 'Dry oracle');
    assert.equal(saved.picks.oddling_show, undefined);
    assert.equal(saved.picks.unknown, undefined);
    assert.deepEqual(sanitizeOddlingPicks(null), {});
    assert.equal(writeOddlingDraft({ setItem() { throw new Error('denied'); } }, picks), false);
    assert.equal(readOddlingDraft({ getItem() { throw new Error('denied'); } }), null);
});

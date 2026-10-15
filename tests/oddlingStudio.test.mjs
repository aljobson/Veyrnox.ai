import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { CHARACTER_GROUPS, ODDLING_ARCHETYPES } from '../app/veyrnox/_lib/character.js';
import {
    ODDLING_MOTIONS,
    ODDLING_PRESET_SOURCES,
    ODDLING_STUDIO_SECTIONS,
    buildOddlingStudioPrompt,
    gallerySource,
    oddlingPortrait,
    animationModel,
    buildOddlingAnimationPrompt,
    oddlingsForSource,
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
test('Build & proportions exposes independent arm and leg sizes in portrait and motion prompts', () => {
    const section = ODDLING_STUDIO_SECTIONS.find((item) => item.id === 'build');
    for (const id of ['arm_size', 'leg_size']) assert.ok(section.groupIds.includes(id));
    for (const mode of ['portrait', 'motion']) {
        const prompt = buildOddlingStudioPrompt({ mode, picks: {
            character_type: 'Human', arm_size: 'Extra Large', leg_size: 'Extra Large', hand_size: 'Small', foot_size: 'Small',
        } });
        assert.match(prompt, /extra-large arms relative to the body/);
        assert.match(prompt, /extra-large legs relative to the body/);
        assert.match(prompt, /small hands relative to the body/);
        assert.match(prompt, /small feet relative to the body/);
    }
});
test('face details exposes independent face size controls in portrait and motion prompts', () => {
    const section = ODDLING_STUDIO_SECTIONS.find((item) => item.id === 'features');
    for (const id of ['ear_size', 'nose_size', 'eye_size', 'mouth_size']) assert.ok(section.groupIds.includes(id));
    for (const mode of ['portrait', 'motion']) {
        const prompt = buildOddlingStudioPrompt({ mode, picks: {
            character_type: 'Human', ears: 'Elf Ears', ear_size: 'Extra Large', nose_size: 'Extra Large', eye_size: 'Extra Large', mouth_size: 'Extra Large',
        } });
        assert.match(prompt, /pointed elf ears/);
        assert.match(prompt, /extra-large ears relative to the head/);
        assert.match(prompt, /extra-large nose relative to the face/);
        assert.match(prompt, /extra-large eyes relative to the face/);
        assert.match(prompt, /extra-large mouth relative to the face/);
    }
});
test('Head & eyes exposes head and neck sizes separately from shape and styling in portrait and motion prompts', () => {
    const section = ODDLING_STUDIO_SECTIONS.find((item) => item.id === 'head');
    assert.ok(section.groupIds.includes('head_size'));
    assert.ok(section.groupIds.includes('neck_size'));
    for (const mode of ['portrait', 'motion']) {
        const prompt = buildOddlingStudioPrompt({ mode, picks: {
            character_type: 'Human', head_shape: 'Square', head_size: 'Extra Large', eye_size: 'Small', neck_size: 'Extra Large', neck: 'Stacked Rings',
        } });
        assert.match(prompt, /strong square head shape/);
        assert.match(prompt, /extra-large head relative to the body, entire head fully visible/);
        assert.match(prompt, /small eyes relative to the face/);
        assert.match(prompt, /extra-large neck relative to the body/);
        assert.match(prompt, /stacked metallic neck rings/);
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

test('every character has its own standalone portrait instead of a sprite panel', async () => {
    const images = new Set();
    const hashes = new Set();
    for (const oddling of ODDLING_ARCHETYPES) {
        const source = gallerySource(oddling);
        assert.equal(source.image, `/oddlings/portraits/${oddling.id}.webp`);
        assert.equal(source.panel, undefined);
        images.add(source.image);
        const bytes = await readFile(new URL(`../public${source.image}`, import.meta.url));
        hashes.add(createHash('sha256').update(bytes).digest('hex'));
        const metadata = await sharp(bytes).metadata();
        assert.equal(metadata.width, 1024);
        assert.equal(metadata.height, 1536);
    }
    assert.equal(images.size, 32);
    assert.equal(hashes.size, 32, 'no character reuses another character image');
});

test('human preset collections are complete, distinct, and human-first', () => {
    assert.deepEqual(ODDLING_PRESET_SOURCES.map((source) => source.id), [
        'body', 'silhouettes', 'fashion', 'hair', 'denim', 'oddities', 'torsos', 'humans', 'beings',
    ]);
    for (const source of ODDLING_PRESET_SOURCES.slice(0, 6)) {
        const oddlings = oddlingsForSource(source.id);
        assert.equal(oddlings.length, 4, `${source.id} should contain one four-character art sheet`);
        assert.ok(oddlings.every((oddling) => oddling.kind === 'human'));
    }
    assert.equal(oddlingsForSource('humans').length, 28);
    assert.equal(oddlingsForSource('beings').length, 4);
    assert.deepEqual(oddlingsForSource('unknown').map((oddling) => oddling.id), oddlingsForSource('body').map((oddling) => oddling.id));
});

test('new torso collection covers all sizes with unique original characters and recreatable passports', () => {
    const characters = oddlingsForSource('torsos');
    assert.deepEqual(characters.map(({ id }) => id), ['pip-parcel', 'mira-measure', 'arlo-archive', 'orla-overture']);
    assert.deepEqual(characters.map(({ picks }) => picks.torso_size), ['Small', 'Medium', 'Large', 'Extra Large']);
    assert.ok(ODDLING_STUDIO_SECTIONS.find(({ id }) => id === 'build').groupIds.includes('torso_size'));
    for (const character of characters) {
        assert.equal(character.kind, 'human');
        for (const mode of ['portrait', 'motion']) {
            const prompt = buildOddlingStudioPrompt({ mode, picks: character.picks });
            assert.ok(prompt.includes(character.name));
            assert.match(prompt, /torso relative to the head and limbs/);
        }
        assert.match(gallerySource(character).image, new RegExp(`${character.id}\\.webp$`));
    }
});

test('animation only resolves known portrait ids and image-to-video models', () => {
    assert.equal(oddlingPortrait('../../etc/passwd'), null);
    assert.equal(oddlingPortrait('https://example.com/portrait.webp'), null);
    const textOnly = { id: 'wan', kind: 'video', credits: 19, media: {} };
    const imageVideo = { id: 'kling-3.0-i2v', kind: 'video', credits: 34, media: { image: { required: true } } };
    assert.equal(animationModel([textOnly]), undefined);
    assert.equal(animationModel([textOnly, imageVideo]), imageVideo);
    assert.equal(animationModel([{ ...imageVideo, gated: true }]), undefined);
    assert.equal(animationModel([{ ...imageVideo, media: { image: { required: true }, audio: { required: true } } }]), undefined);
    assert.equal(animationModel([{ ...imageVideo, durations: [10] }]), undefined);
    assert.equal(buildOddlingAnimationPrompt('unknown', 'deadpan-turn'), '');
    const prompt = buildOddlingAnimationPrompt('shelf-life', 'micro-dance');
    assert.match(prompt, /exact single character in the start image/);
    assert.match(prompt, /one simple repeatable dance move/);
    assert.match(prompt, /Preserve the face, body shape and size, outfit colors and fit/);
});

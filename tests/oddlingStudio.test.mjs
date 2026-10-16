import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { CHARACTER_GROUPS, ODDLING_ARCHETYPES } from '../app/veyrnox/_lib/character.js';
import {
    ODDLING_MOTIONS,
    ODDLING_DOLL_FACETS,
    ODDLING_PRESET_SOURCES,
    ODDLING_STUDIO_SECTIONS,
    buildOddlingStudioPrompt,
    gallerySource,
    oddlingPortrait,
    animationModel,
    buildOddlingAnimationPrompt,
    oddlingsForSource,
    oddlingCreditState,
    randomizeOddlingStyle,
    randomizeOddlingAll,
    sectionProgress,
    toggleOpenSection,
    readOddlingLibrary,
    saveOddlingToLibrary,
} from '../app/veyrnox/_lib/oddlingStudio.js';
import { sanitizeOddlingPicks } from '../app/veyrnox/_lib/character.js';

test('every full-studio section resolves to real character groups', () => {
    const ids = new Set(CHARACTER_GROUPS.map((group) => group.id));
    assert.equal(ODDLING_STUDIO_SECTIONS.length, 8);
    for (const section of ODDLING_STUDIO_SECTIONS) {
        assert.ok(section.groupIds.length > 0);
        for (const id of section.groupIds) assert.ok(ids.has(id), `${section.id} references missing ${id}`);
    }
});
test('doll lab quick picks are valid canonical body, hair and wardrobe traits', () => {
    assert.deepEqual(ODDLING_DOLL_FACETS.map(({ id }) => id), ['body_type', 'hair', 'wardrobe_style']);
    for (const facet of ODDLING_DOLL_FACETS) {
        const valid = new Set(CHARACTER_GROUPS.find(({ id }) => id === facet.id).options.map(([value]) => value));
        assert.equal(facet.options.length, 4);
        for (const [value, label] of facet.options) {
            assert.ok(valid.has(value), `${value} must remain a valid ${facet.id} choice`);
            assert.ok(label);
        }
    }
});
test('low-credit prompt distinguishes a warning from an unaffordable generation', () => {
    assert.deepEqual(oddlingCreditState(4, 2), { low: true, insufficient: false });
    assert.deepEqual(oddlingCreditState(1, 2), { low: true, insufficient: true });
    assert.deepEqual(oddlingCreditState(20, 2), { low: false, insufficient: false });
    assert.equal(oddlingCreditState(null, 2), null);
    assert.equal(oddlingCreditState(20, null), null);
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

// A deterministic stand-in for Math.random that walks the unit interval.
const sequence = (seed) => { let state = seed; return () => (state = (state * 9301 + 49297) % 233280) / 233280; };

test('Surprise me rolls every trait group, keeps the creator words and stays adult-safe', () => {
    const picks = { character_type: 'Alien', oddling_name: 'Long Division', oddling_obsession: 'door frames', oddling_voice: 'Dry oracle', oddling_show: 'Tiny field reports', oddling_rule: 'always holds a ruler', body_type: 'Fat' };
    for (const seed of [1, 7, 42, 1234, 99999]) {
        const rolled = randomizeOddlingAll(picks, sequence(seed));
        assert.deepEqual(sanitizeOddlingPicks(rolled), rolled, 'every value is a listed option');
        assert.equal(rolled.oddling_name, 'Long Division');
        assert.equal(rolled.oddling_obsession, 'door frames');
        assert.equal(rolled.oddling_voice, 'Dry oracle');
        assert.equal(rolled.oddling_show, 'Tiny field reports');
        assert.equal(rolled.oddling_rule, 'always holds a ruler');
        const groups = CHARACTER_GROUPS.filter((group) => rolled[group.id]);
        assert.ok(groups.length >= CHARACTER_GROUPS.length - 6, `${groups.length} of ${CHARACTER_GROUPS.length} groups rolled`);
        assert.ok(['20s', '30s', '40s', '50s', '60s', '70+'].includes(rolled.age));
        for (const limb of ['left_arm', 'right_arm', 'left_leg', 'right_leg']) assert.notEqual(rolled[limb], 'None');
    }
    const changed = randomizeOddlingAll(picks, sequence(5));
    assert.notEqual(changed.body_type, undefined);
    assert.ok(Object.keys(changed).length > Object.keys(randomizeOddlingStyle(picks, sequence(5))).length, 'wider than Randomize styling');
});

test('Surprise me can reach every option of a group and leans human-first', () => {
    const seen = new Map();
    for (let seed = 1; seed <= 400; seed++) {
        const rolled = randomizeOddlingAll({}, sequence(seed));
        for (const [id, value] of Object.entries(rolled)) seen.set(id, (seen.get(id) || new Set()).add(value));
    }
    const hair = CHARACTER_GROUPS.find(({ id }) => id === 'hair').options.map(([value]) => value);
    assert.deepEqual([...seen.get('hair')].sort(), [...hair].sort());
    const types = [...Array(400)].map((_, index) => randomizeOddlingAll({}, sequence(index + 1)).character_type);
    const humans = types.filter((type) => type === 'Human').length;
    assert.ok(humans > 160 && humans < 320, `${humans} of 400 were Human`);
    assert.equal(randomizeOddlingAll({}, () => 0).character_type, 'Human');
    const lastType = CHARACTER_GROUPS.find(({ id }) => id === 'character_type').options.at(-1)[0];
    assert.equal(randomizeOddlingAll(null, () => 0.999999).character_type, lastType);
});

test('Surprise me resolves clashes the way a hand edit does', () => {
    for (let seed = 1; seed <= 400; seed++) {
        const rolled = randomizeOddlingAll({}, sequence(seed));
        assert.ok(!(rolled.head_size && ['Tiny Head', 'Oversized Head'].includes(rolled.head_shape)), `seed ${seed}`);
        assert.ok(!(rolled.torso_size && ['Tiny Torso', 'Long Torso'].includes(rolled.proportions)), `seed ${seed}`);
        assert.ok(!(rolled.hand_size && ['Huge Hands', 'Tiny Hands'].includes(rolled.proportions)), `seed ${seed}`);
    }
});

test('builder section headers report picked of total and sections open independently', () => {
    for (const section of ODDLING_STUDIO_SECTIONS) {
        assert.deepEqual(sectionProgress(section, {}), { picked: 0, total: section.groupIds.length });
    }
    const build = ODDLING_STUDIO_SECTIONS.find(({ id }) => id === 'build');
    assert.deepEqual(sectionProgress(build, { body_type: 'Pear', height: 'Tall', hair: 'Bald', arm_size: '' }), { picked: 2, total: build.groupIds.length });
    assert.deepEqual(sectionProgress({ groupIds: ['hair', 'not-a-group'] }, { hair: 'Bald' }), { picked: 1, total: 1 });
    assert.deepEqual(sectionProgress(null, null), { picked: 0, total: 0 });
    assert.deepEqual(toggleOpenSection(['build'], 'hair'), ['build', 'hair']);
    assert.deepEqual(toggleOpenSection(['build', 'hair'], 'build'), ['hair']);
    assert.deepEqual(toggleOpenSection(undefined, 'hair'), ['hair']);
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
        'all', 'body', 'silhouettes', 'fashion', 'hair', 'denim', 'oddities', 'torsos', 'humans', 'beings',
    ]);
    for (const source of ODDLING_PRESET_SOURCES.slice(1, 7)) {
        const oddlings = oddlingsForSource(source.id);
        assert.equal(oddlings.length, 4, `${source.id} should contain one four-character art sheet`);
        assert.ok(oddlings.every((oddling) => oddling.kind === 'human'));
    }
    assert.equal(oddlingsForSource('humans').length, 28);
    assert.equal(oddlingsForSource('beings').length, 4);
});

test('the All source lists every original character once and is where an unknown source lands', () => {
    const everyone = oddlingsForSource('all');
    assert.deepEqual(everyone.map(({ id }) => id), ODDLING_ARCHETYPES.map(({ id }) => id));
    assert.equal(everyone.length, 32);
    assert.equal(new Set(everyone.map(({ id }) => id)).size, 32);
    assert.notEqual(everyone, ODDLING_ARCHETYPES, 'callers get a copy they can sort without touching the cast');
    assert.deepEqual(oddlingsForSource('unknown').map(({ id }) => id), everyone.map(({ id }) => id));
    for (const source of ODDLING_PRESET_SOURCES) {
        for (const oddling of oddlingsForSource(source.id)) assert.ok(everyone.some(({ id }) => id === oddling.id), `${source.id}: ${oddling.id}`);
    }
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

import test from 'node:test';
import assert from 'node:assert/strict';
import {
    CHARACTER_BASE,
    CHARACTER_GROUPS,
    CHARACTER_TABS,
    ODDLING_ARCHETYPES,
    buildCharacterPrompt,
    characterTraits,
    readOddlingDraft,
    sanitizeOddlingPicks,
    writeOddlingDraft,
} from '../app/veyrnox/_lib/character.js';
import {
    CHARACTER_NEW_GROUPS,
    CHARACTER_OPTION_ADDITIONS,
    changeCharacterPick,
    characterOptionLabel,
    extendCharacterGroups,
} from '../app/veyrnox/_lib/characterOptions.js';
import { randomizeOddlingStyle, readOddlingLibrary, saveOddlingToLibrary } from '../app/veyrnox/_lib/oddlingStudio.js';

const group = (id) => CHARACTER_GROUPS.find((item) => item.id === id);
const labels = (id) => group(id).options.map(([label]) => label);
const phrase = (id, label) => group(id).options.find(([value]) => value === label)?.[1];
const countOptions = (groups) => groups.reduce((sum, item) => sum + item.options.length, 0);
const storage = () => {
    const values = new Map();
    return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
};

// Everything this vocabulary added, as [groupId, label, phrase] rows.
const added = [
    ...CHARACTER_NEW_GROUPS.flatMap((item) => item.options.map(([label, text]) => [item.id, label, text])),
    ...Object.entries(CHARACTER_OPTION_ADDITIONS).flatMap(([id, blocks]) => blocks.flatMap((block) => block.options.map(([label, text]) => [id, label, text]))),
];

test('the builder totals describe the whole vocabulary: 51 groups, 390 options, 27 Face / 16 Body / 8 Style', () => {
    assert.equal(CHARACTER_GROUPS.length, 51);
    assert.equal(countOptions(CHARACTER_GROUPS), 390);
    assert.deepEqual(CHARACTER_TABS, ['Face', 'Body', 'Style']);
    for (const [tab, total] of [['Face', 27], ['Body', 16], ['Style', 8]]) {
        assert.equal(CHARACTER_GROUPS.filter((item) => item.tab === tab).length, total, `${tab} group count`);
    }
    assert.equal(new Set(CHARACTER_GROUPS.map((item) => item.id)).size, 51, 'group ids are unique');
    for (const item of CHARACTER_GROUPS) {
        assert.ok(CHARACTER_TABS.includes(item.tab), `${item.id} sits on a known tab`);
        assert.ok(item.label, `${item.id} has a label`);
        assert.equal(new Set(item.options.map(([label]) => label)).size, item.options.length, `${item.id} labels are unique`);
        for (const [label, text] of item.options) assert.ok(label && text, `${item.id} option ${label} has a prompt phrase`);
    }
});

test('what this change added is exactly 8 new groups and 84 options on top of the previous 43 groups and 306 options', () => {
    assert.equal(CHARACTER_NEW_GROUPS.length, 8);
    assert.equal(countOptions(CHARACTER_NEW_GROUPS), 42);
    assert.equal(added.length, 84);
    assert.equal(CHARACTER_GROUPS.length - CHARACTER_NEW_GROUPS.length, 43);
    assert.equal(countOptions(CHARACTER_GROUPS) - added.length, 306);
    assert.deepEqual(CHARACTER_NEW_GROUPS.map(({ id }) => id),
        ['exaggeration', 'brows', 'nose_shape', 'cheeks', 'lips', 'chin_jaw', 'headwear', 'everyday_accessories']);
});

test('new groups sit next to the traits they refine, so prompts and tabs read in a sensible order', () => {
    const face = CHARACTER_GROUPS.filter((item) => item.tab === 'Face').map(({ id }) => id);
    assert.equal(face[face.indexOf('character_type') + 1], 'exaggeration');
    const afterShape = face.slice(face.indexOf('head_shape') + 1, face.indexOf('head_shape') + 6);
    assert.deepEqual(afterShape, ['brows', 'nose_shape', 'cheeks', 'lips', 'chin_jaw']);
    const style = CHARACTER_GROUPS.filter((item) => item.tab === 'Style').map(({ id }) => id);
    assert.deepEqual(style, ['hair', 'hair_color', 'wardrobe_style', 'headwear', 'everyday_accessories', 'accessories', 'distinctive_features', 'rendering_style']);
    for (const item of CHARACTER_NEW_GROUPS) assert.equal(group(item.id).tab, item.tab);
    assert.equal(Object.keys(group('brows')).sort().join(), 'id,label,options,tab', 'placement metadata is not leaked into groups');
});

test('Cat, Dog, Rodent and Bird are anthropomorphic adult original characters', () => {
    for (const [label, noun] of [['Cat', 'cat'], ['Dog', 'dog'], ['Rodent', 'rodent'], ['Bird', 'bird']]) {
        const text = phrase('character_type', label);
        assert.match(text, new RegExp(`^anthropomorphic adult ${noun} character`), label);
        assert.doesNotMatch(text, /furry|cub\b|kitten|puppy|chick\b|baby/i, label);
        const prompt = buildCharacterPrompt('', { character_type: label });
        assert.ok(prompt.startsWith(CHARACTER_BASE));
        assert.ok(prompt.includes(text));
    }
    assert.equal(labels('character_type')[0], 'Human');
    assert.deepEqual(labels('character_type').slice(-4), ['Cat', 'Dog', 'Rodent', 'Bird']);
});

test('Exaggeration offers Natural, Bold and Extreme as a modifier that follows the character type', () => {
    assert.deepEqual(labels('exaggeration'), ['Natural', 'Bold', 'Extreme']);
    const phrases = group('exaggeration').options.map(([, text]) => text);
    assert.equal(new Set(phrases).size, 3);
    assert.match(phrases[0], /natural/);
    assert.match(phrases[1], /bold .*exaggeration/);
    assert.match(phrases[2], /extreme .*exaggeration/);
    // Exaggeration styles proportions and styling only; it never names or implies heritage or skin.
    for (const text of phrases) assert.doesNotMatch(text, /heritage|ethnic|race|racial|skin|origin|nationality/i, text);
    assert.deepEqual(characterTraits({ gender: 'Female', exaggeration: 'Extreme', character_type: 'Cat' }),
        [phrase('character_type', 'Cat'), phrases[2], 'female']);
    assert.ok(buildCharacterPrompt('', { exaggeration: 'Bold' }).includes(phrases[1]));
});

test('the face gains nose shape, lips, chin and jaw, cheeks, brows, teeth, stubble and beards', () => {
    assert.deepEqual(labels('nose_shape'), ['Straight', 'Button', 'Aquiline', 'Snub', 'Wide', 'Narrow', 'Round Tip']);
    assert.deepEqual(labels('lips'), ['Full', 'Thin', 'Cupid Bow', 'Glossy', 'Matte Dark']);
    assert.deepEqual(labels('chin_jaw'), ['Strong Jaw', 'Soft Jaw', 'Pointed Chin', 'Round Chin', 'Cleft Chin', 'Prominent Chin']);
    assert.deepEqual(labels('cheeks'), ['High Cheekbones', 'Full Cheeks', 'Dimples', 'Hollow Cheeks']);
    assert.deepEqual(labels('brows'), ['Thick', 'Thin', 'Arched', 'Straight', 'Bushy', 'Bleached']);
    for (const label of ['Gap Teeth', 'Crooked Teeth', 'Gold Tooth', 'Bright Smile']) assert.ok(labels('mouth').includes(label), label);
    assert.equal(group('mouth').label, 'Mouth & Teeth');
    assert.deepEqual(labels('facial_hair').slice(0, 4), ['Clean Shaven', 'Stubble', 'Full Beard', 'Goatee']);
    assert.equal(labels('facial_hair').length, 9);
    // Independent from the size groups of the same features.
    const prompt = buildCharacterPrompt('', { nose_shape: 'Button', nose_size: 'Small', lips: 'Full', chin_jaw: 'Cleft Chin', cheeks: 'Dimples', brows: 'Arched' });
    for (const text of ['small rounded button nose', 'small nose relative to the face', 'full soft lips', 'cleft chin', 'visible dimples', 'high arched eyebrows']) {
        assert.ok(prompt.includes(text), text);
    }
});

test('eyes gain almond, monolid, hooded and uneven shapes, Hazel, and the skin scale gains a light step', () => {
    assert.deepEqual(labels('eye_shape').slice(3, 8), ['Upturned', 'Almond', 'Monolid', 'Hooded', 'Uneven']);
    assert.equal(labels('eye_shape').length, 11);
    assert.ok(labels('eye_color').includes('Hazel'));
    assert.equal(phrase('eye_color', 'Hazel'), 'hazel eyes');
    const tones = labels('skin_tone');
    assert.equal(tones.indexOf('Light'), tones.indexOf('Golden') + 1);
    assert.equal(tones.indexOf('Fair'), tones.indexOf('Light') + 1);
    assert.equal(tones.length, 8);
    for (const label of ['Almond', 'Monolid', 'Hooded', 'Uneven']) {
        assert.doesNotMatch(phrase('eye_shape', label), /asian|african|european|heritage|race|ethnic/i, label);
    }
});

test('hair gains 14 styles and 5 colours without moving the existing first choices', () => {
    const styles = ['Buzz Cut', 'Bowl Cut', 'Mullet', 'Braids', 'Pigtails', 'Perm', 'Beehive', 'Pixie Cut', 'Ponytail', 'Top Knot', 'Undercut', 'Pompadour', 'Cornrows', 'Locs'];
    const colours = ['Ginger', 'Auburn', 'Platinum', 'Lilac', 'Teal'];
    for (const label of styles) assert.ok(labels('hair').includes(label), label);
    for (const label of colours) assert.ok(labels('hair_color').includes(label), label);
    assert.equal(labels('hair').length, 40);
    assert.equal(labels('hair_color').length, 17);
    assert.equal(labels('hair')[0], 'Bald', 'random styling at 0 still lands on Bald');
    assert.equal(labels('hair_color')[0], 'Black');
    // Human styles sit before the non-human hair (tentacles, spines, antennae, flowers).
    assert.ok(labels('hair').indexOf('Locs') < labels('hair').indexOf('Fur / Mane'));
    assert.ok(labels('hair').indexOf('Punk') < labels('hair').indexOf('Buzz Cut'));
    assert.match(phrase('hair', 'Pigtails'), /adult/);
    assert.match(phrase('hair', 'Bowl Cut'), /adult/);
});

test('style gains everyday looks, hats and headphones, and everyday accessories at normal scale', () => {
    assert.deepEqual(labels('wardrobe_style').slice(-6), ['Streetwear', 'Y2K', 'Goth', 'Retro', 'Sporty', 'Business Suit']);
    assert.equal(labels('wardrobe_style')[0], 'Office Surrealist');
    assert.deepEqual(labels('headwear'), ['Baseball Cap', 'Beanie', 'Wide-Brim Hat', 'Bucket Hat', 'Headphones']);
    assert.deepEqual(labels('everyday_accessories'), ['Glasses', 'Round Glasses', 'Sunglasses', 'Jewellery', 'Everyday Bag', 'Tote Bag']);
    assert.match(phrase('everyday_accessories', 'Glasses'), /normal scale/);
    assert.match(phrase('headwear', 'Headphones'), /headphones/);
    const prompt = buildCharacterPrompt('', { wardrobe_style: 'Goth', headwear: 'Beanie', everyday_accessories: 'Jewellery' });
    assert.ok(prompt.includes(phrase('wardrobe_style', 'Goth')));
    assert.ok(prompt.includes('knitted beanie'));
    assert.ok(prompt.includes('hoop earrings'));
});

// The option lists of every group that gained options, exactly as they were
// before this vocabulary: saved passports store these labels.
const LEGACY_OPTIONS = {
    character_type: ['Human', 'Elf', 'Alien', 'Moth', 'Spectre', 'Fungus', 'Amphibian', 'Reptile', 'Mantis', 'Bee', 'Octopus', 'Crocodile', 'Iguana', 'Lizard', 'Beetle', 'Ant'],
    skin_tone: ['Deep', 'Rich Brown', 'Warm Brown', 'Olive', 'Golden', 'Fair', 'Porcelain'],
    eye_color: ['Blue', 'Brown', 'Green', 'Amber', 'Grey', 'Red', 'Purple', 'Black', 'Deep Brown', 'White', 'Solid Black', 'Blind / Empty'],
    eye_shape: ['Round', 'Narrow', 'Downturned', 'Upturned', 'Wide Set', 'Close Set', 'Graphic Liner'],
    mouth: ['Small Mouth', 'Large Mouth', 'No Teeth', 'Unique Teeth', 'Sharp Teeth', 'Forked Tongue', 'Two Tongues'],
    facial_hair: ['Clean Shaven', 'Pencil Moustache', 'Giant Moustache', 'Forked Beard', 'Beard Cube', 'Single Chin Curl'],
    hair: ['Bald', 'Short Hair', 'Sharp Bob', 'Sculpted Waves', 'Sculptural Wave Tower', 'Monumental Hair', 'Cube Cut', 'Sphere Cut', 'Wedge Cut', 'Tabletop', 'Spiral Tower', 'Crescent Cut', 'Twin Discs', 'Zigzag Cut', 'Anvil Cut', 'Donut Halo', 'Tube Tower', 'Shelf Cut', 'Long Hair', 'Afro', 'Punk', 'Fur / Mane', 'Tentacles', 'Spines', 'Antennae', 'Flowers'],
    hair_color: ['Black', 'Brown', 'Blonde', 'Silver', 'White', 'Copper', 'Acid Green', 'Electric Blue', 'Burgundy', 'Pink', 'Split Color', 'Rainbow Stripe'],
    wardrobe_style: ['Office Surrealist', 'Quilted Royalty', 'Utility Pop', 'Domestic Futurist', 'Ceremonial Sportswear', 'Tiny Formalwear', 'Soft Sculpture', 'Weather Couture', 'Modern Basics'],
};

test('every option the earlier builder offered is still there, in its original order and wording', () => {
    const legacyCount = Object.values(LEGACY_OPTIONS).reduce((sum, list) => sum + list.length, 0);
    assert.equal(legacyCount, 102);
    for (const [id, legacy] of Object.entries(LEGACY_OPTIONS)) {
        const fresh = new Set(added.filter(([groupId]) => groupId === id).map(([, label]) => label));
        assert.deepEqual(labels(id).filter((label) => !fresh.has(label)), legacy, `${id} keeps its earlier options in order`);
        assert.equal(labels(id).length, legacy.length + fresh.size, id);
    }
    assert.equal(phrase('hair', 'Punk'), 'punk mohawk hairstyle');
    assert.equal(phrase('eye_color', 'Blind / Empty'), 'pupil-free white eyes as a fictional visual effect');
    // A few well-known legacy keys that saved passports and the 32 cast members rely on.
    for (const [id, label] of [['hair', 'Flowers'], ['eye_color', 'Blind / Empty'], ['body_type', 'Very Skinny'], ['wardrobe_style', 'Modern Basics'], ['character_type', 'Spectre'], ['accessories', 'Bug Head Mask']]) {
        assert.ok(labels(id).includes(label), `${id}/${label}`);
        assert.deepEqual(sanitizeOddlingPicks({ [id]: label }), { [id]: label });
    }
    for (const oddling of ODDLING_ARCHETYPES) assert.deepEqual(sanitizeOddlingPicks(oddling.picks), oddling.picks, oddling.id);
});

test('extendCharacterGroups inserts after anchors, appends when an anchor is missing, and never mutates its input', () => {
    const core = Object.freeze([
        Object.freeze({ id: 'a', tab: 'Face', label: 'A', options: Object.freeze([['one', '1'], ['two', '2'], ['three', '3']]) }),
        Object.freeze({ id: 'b', tab: 'Style', label: 'B', options: Object.freeze([['x', 'x']]) }),
    ]);
    const out = extendCharacterGroups(core, {
        a: [{ after: 'one', options: [['one-and-a-half', '1.5'], ['two', 'dup']] }, { after: 'missing', options: [['four', '4']] }],
        nope: [{ after: 'x', options: [['ignored', 'i']] }],
    }, [
        { id: 'c', tab: 'Face', label: 'C', after: 'a', options: [['c1', 'c1']] },
        { id: 'd', tab: 'Face', label: 'D', after: 'a', options: [['d1', 'd1']] },
        { id: 'e', tab: 'Style', label: 'E', after: 'unknown-anchor', options: [['e1', 'e1']] },
        { id: 'a', tab: 'Face', label: 'dup of an existing id', after: 'b', options: [['z', 'z']] },
    ]);
    assert.deepEqual(out.map(({ id }) => id), ['a', 'c', 'd', 'b', 'e']);
    assert.deepEqual(out[0].options.map(([label]) => label), ['one', 'one-and-a-half', 'two', 'three', 'four']);
    assert.deepEqual(out[1], { id: 'c', tab: 'Face', label: 'C', options: [['c1', 'c1']] });
    assert.deepEqual(out[3].options, [['x', 'x']]);
    assert.equal(core[0].options.length, 3);
    assert.equal(core.length, 2);
    assert.deepEqual(extendCharacterGroups(core, {}, []), core);
});

test('new vocabulary stays adult, original and short enough to leave room for the Oddling identity', () => {
    const minorWords = /\b(child|children|kid|kids|teen|teens|teenage|teenager|tween|schoolgirl|schoolboy|girl|boy|baby|toddler|infant|youth|juvenile|minor|underage|loli|shota|preteen|adolescent|puppy|kitten|cub|chick)\b/i;
    const names = /\b(nike|adidas|puma|gucci|prada|chanel|dior|versace|supreme|apple|airpods|beats|ray-?ban|disney|pixar|marvel|pokemon|pok[eé]mon|mickey|minnie|hello kitty|garfield|sonic|batman|superman|barbie|lego|elvis|beatles|bowie|madonna|taylor swift|harry potter|naruto|goku)\b/i;
    const realPeople = /\b(celebrity|lookalike|look-alike|resembling|as played by|famous|real person|likeness)\b/i;
    for (const item of CHARACTER_GROUPS) for (const [label, text] of item.options) {
        assert.doesNotMatch(`${label} ${text}`, minorWords, `${item.id}/${label} must not suggest a minor`);
    }
    for (const [id, label, text] of added) {
        assert.doesNotMatch(`${label} ${text}`, names, `${id}/${label} must not name a brand or franchise`);
        assert.doesNotMatch(`${label} ${text}`, realPeople, `${id}/${label} must not point at a real person`);
        assert.ok(text.length <= 90, `${id}/${label} phrase is ${text.length} characters`);
        assert.equal(text, text.trim());
    }
    assert.ok(Math.max(...added.map(([, , text]) => text.length)) <= 90);
    assert.match(CHARACTER_BASE, /original adult character, not a real person/);
});

test('a fully styled Oddling with the new traits keeps its identity inside the 2000 character gateway limit', () => {
    const picks = {
        character_type: 'Cat', exaggeration: 'Extreme', gender: 'Non-binary', ethnicity_origin_base: 'Mixed', age: '30s', skin_tone: 'Light',
        eye_color: 'Hazel', eye_shape: 'Hooded', mouth: 'Gap Teeth', head_shape: 'Heart', brows: 'Bushy', nose_shape: 'Aquiline',
        cheeks: 'High Cheekbones', lips: 'Matte Dark', chin_jaw: 'Prominent Chin', facial_hair: 'Full Beard',
        body_type: 'Athletic', height: 'Tall', hair: 'Bowl Cut', hair_color: 'Platinum', wardrobe_style: 'Streetwear', headwear: 'Wide-Brim Hat',
        everyday_accessories: 'Everyday Bag', distinctive_features: 'Miniature Cake', rendering_style: 'Hyper-Realistic',
        oddling_name: 'Marlow Quill', oddling_obsession: 'pocket-sized rituals and the stories hidden in everyday commutes',
        oddling_voice: 'Dry oracle', oddling_show: 'Tiny field reports', oddling_rule: 'pale grey feline face, round wire glasses, mustard streetwear set',
    };
    const prompt = buildCharacterPrompt('Full-body studio introduction, neutral backdrop', picks);
    assert.ok(prompt.length < 1700, `prompt is ${prompt.length} characters`);
    assert.ok(prompt.includes('fictional creator named Marlow Quill'));
    assert.ok(prompt.endsWith('Full-body studio introduction, neutral backdrop'));
    assert.deepEqual(sanitizeOddlingPicks(picks), picks);
});

test('picks made with every new option survive sanitising, passport saving and History, and bad values are dropped', () => {
    for (const [id, label] of added) {
        const picks = { character_type: 'Human', [id]: label };
        assert.deepEqual(sanitizeOddlingPicks(picks), picks, `${id}/${label}`);
        const local = storage();
        assert.equal(writeOddlingDraft(local, picks, 99), true);
        assert.deepEqual(readOddlingDraft(local).picks, picks);
        assert.equal(saveOddlingToLibrary(local, picks, '', 99).ok, true);
        assert.deepEqual(readOddlingLibrary(local)[0].picks, picks);
        assert.ok(buildCharacterPrompt('', picks).includes(phrase(id, label)), `${id}/${label} reaches the prompt`);
    }
    assert.deepEqual(sanitizeOddlingPicks({
        exaggeration: 'Maximum', nose_shape: 'Hooked', lips: '<b>Full</b>', character_type: 'Cat ', headwear: 'AirPods', hair: 'bowl cut', brows: 'thick',
    }), {});
});

test('new options display as stored, because none of them needs a softened label', () => {
    for (const [id, label] of added) assert.equal(characterOptionLabel(id, label), label, `${id}/${label}`);
    assert.equal(characterOptionLabel('proportions', 'Natural'), 'Balanced proportions');
    assert.equal(characterOptionLabel('exaggeration', 'Natural'), 'Natural');
    assert.equal(characterOptionLabel('nose_shape', 'Straight'), 'Straight');
});

test('an explicit brow or everyday eyewear choice replaces the surreal version it would contradict', () => {
    assert.deepEqual(changeCharacterPick({ face_features: 'Tiny Brows', cheeks: 'Dimples' }, 'brows', 'Thick'), { cheeks: 'Dimples', brows: 'Thick' });
    assert.deepEqual(changeCharacterPick({ face_features: 'One Brow' }, 'brows', 'Arched'), { brows: 'Arched' });
    assert.deepEqual(changeCharacterPick({ brows: 'Thick', cheeks: 'Dimples' }, 'face_features', 'One Brow'), { cheeks: 'Dimples', face_features: 'One Brow' });
    assert.deepEqual(changeCharacterPick({ brows: 'Thick' }, 'face_features', 'Huge Lashes'), { brows: 'Thick', face_features: 'Huge Lashes' });
    assert.deepEqual(changeCharacterPick({ face_features: 'Huge Lashes' }, 'brows', 'Thick'), { face_features: 'Huge Lashes', brows: 'Thick' });
    assert.deepEqual(changeCharacterPick({ accessories: 'Tiny Sunglasses', headwear: 'Beanie' }, 'everyday_accessories', 'Glasses'),
        { headwear: 'Beanie', everyday_accessories: 'Glasses' });
    assert.deepEqual(changeCharacterPick({ accessories: 'Tiny Monocle' }, 'everyday_accessories', 'Sunglasses'), { everyday_accessories: 'Sunglasses' });
    assert.deepEqual(changeCharacterPick({ everyday_accessories: 'Round Glasses' }, 'accessories', 'Tiny Monocle'), { accessories: 'Tiny Monocle' });
    assert.deepEqual(changeCharacterPick({ accessories: 'Tiny Sunglasses' }, 'everyday_accessories', 'Everyday Bag'),
        { accessories: 'Tiny Sunglasses', everyday_accessories: 'Everyday Bag' });
    assert.deepEqual(changeCharacterPick({ everyday_accessories: 'Jewellery' }, 'accessories', 'Tiny Sunglasses'),
        { everyday_accessories: 'Jewellery', accessories: 'Tiny Sunglasses' });
    assert.deepEqual(changeCharacterPick({ brows: 'Thick', face_features: 'One Brow' }, 'brows', ''), { face_features: 'One Brow' });
});

test('styling randomization only ever lands on supported options, including the new styles', () => {
    const seen = new Set();
    for (let step = 0; step <= 40; step += 1) {
        const roll = step / 40;
        const remixed = randomizeOddlingStyle({ character_type: 'Human', body_type: 'Barrel', oddling_name: 'Fixed' }, () => roll);
        assert.deepEqual(sanitizeOddlingPicks(remixed), remixed, `roll ${roll}`);
        assert.equal(remixed.body_type, 'Barrel');
        assert.equal(remixed.oddling_name, 'Fixed');
        assert.ok(buildCharacterPrompt('', remixed).startsWith(CHARACTER_BASE));
        seen.add(remixed.hair);
        seen.add(remixed.wardrobe_style);
    }
    assert.ok(seen.has('Pigtails') || seen.has('Mullet') || seen.has('Beehive'), 'a sweep reaches the new hairstyles');
    assert.ok(seen.has('Goth') || seen.has('Streetwear') || seen.has('Business Suit'), 'a sweep reaches the new looks');
    const first = randomizeOddlingStyle({}, () => 0);
    assert.equal(first.hair, 'Bald');
    assert.equal(first.wardrobe_style, 'Office Surrealist');
    assert.equal(first.facial_hair, 'Clean Shaven');
});

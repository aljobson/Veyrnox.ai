import test from 'node:test';
import assert from 'node:assert/strict';
import {
    CHARACTER_GROUPS,
    ODDLING_ARCHETYPES,
    buildCharacterPrompt,
    characterTraits,
    sanitizeOddlingPicks,
} from '../app/veyrnox/_lib/character.js';
import {
    CHARACTER_NEW_GROUPS,
    EXAGGERATION_GUARD,
    EXAGGERATION_SCOPE,
    changeCharacterPick,
    resolveExclusivePicks,
} from '../app/veyrnox/_lib/characterOptions.js';
import { ODDLING_STUDIO_SECTIONS, randomizeOddlingStyle } from '../app/veyrnox/_lib/oddlingStudio.js';

// Contradictions between picks, and what Exaggeration may touch: the rules that keep a
// finished prompt from asking for two things that cannot both be true. The vocabulary
// itself is pinned in characterVocabulary.test.mjs.
const group = (id) => CHARACTER_GROUPS.find((item) => item.id === id);
const labels = (id) => group(id).options.map(([label]) => label);
const phrase = (id, label) => group(id).options.find(([value]) => value === label)?.[1];

test('in a full prompt, Bold and Extreme never exaggerate heritage, skin tone or the face, whatever else is picked', () => {
    // A few older head, body and neck phrases say "exaggerated" for the user's own pick; those are left out of the word count below.
    const plainHeadShape = labels('head_shape').find((label) => !/exaggerat/i.test(phrase('head_shape', label)));
    const faceShape = {
        head_shape: plainHeadShape, eye_shape: 'Monolid', nose_shape: 'Wide', lips: 'Full', cheeks: 'Full Cheeks', chin_jaw: 'Prominent Chin', brows: 'Thick',
    };
    for (const ethnicity of labels('ethnicity_origin_base')) for (const skin of labels('skin_tone')) for (const level of ['Bold', 'Extreme']) {
        const picks = { character_type: 'Human', exaggeration: level, ethnicity_origin_base: ethnicity, skin_tone: skin, ...faceShape };
        const prompt = buildCharacterPrompt('Full-body studio introduction', picks);
        const modifier = phrase('exaggeration', level);
        const at = prompt.indexOf(modifier);
        const where = `${level} + ${ethnicity} + ${skin}`;
        assert.ok(at > 0, `${where}: the modifier reaches the prompt`);
        assert.equal(prompt.split(EXAGGERATION_GUARD).length - 1, 1, `${where}: the guard clause is present exactly once`);
        assert.doesNotMatch(prompt, /caricature/i, where);
        // Every use of the word sits inside the modifier phrase, so nothing else in the prompt can be read as exaggerated.
        for (const match of prompt.matchAll(/exaggerat\w*/gi)) {
            assert.ok(match.index >= at && match.index < at + modifier.length, `${where}: "${match[0]}" sits inside the modifier`);
        }
        // What the exaggeration may scale is the part before the semicolon; the heritage, skin and face phrases are outside it.
        const scope = modifier.slice(modifier.indexOf(' of ') + 4, modifier.indexOf(';'));
        assert.equal(scope, EXAGGERATION_SCOPE, where);
        for (const [id, label] of Object.entries({ ethnicity_origin_base: ethnicity, skin_tone: skin, ...faceShape })) {
            assert.ok(prompt.includes(phrase(id, label)), `${where}: ${id} phrase is kept as picked`);
        }
    }
    // The same holds beside every nose, lips and eye pick on its own.
    for (const id of ['nose_shape', 'lips', 'eye_shape', 'cheeks', 'chin_jaw', 'brows', 'face_features']) for (const [label, text] of group(id).options) {
        const prompt = buildCharacterPrompt('', { character_type: 'Human', exaggeration: 'Extreme', ethnicity_origin_base: 'African', [id]: label });
        assert.ok(prompt.includes(EXAGGERATION_GUARD) && prompt.includes(text), `${id}/${label}`);
    }
});

test('an explicit brow, eyewear, bag or headwear choice replaces the surreal version it would contradict', () => {
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
    // Chrome Brows are eyebrows too.
    assert.deepEqual(changeCharacterPick({ accessories: 'Chrome Brows', cheeks: 'Dimples' }, 'brows', 'Bushy'), { cheeks: 'Dimples', brows: 'Bushy' });
    assert.deepEqual(changeCharacterPick({ brows: 'Bushy' }, 'accessories', 'Chrome Brows'), { accessories: 'Chrome Brows' });
    assert.deepEqual(changeCharacterPick({ accessories: 'Chrome Brows' }, 'brows', ''), { accessories: 'Chrome Brows' });
    // An everyday bag and a surreal handbag are two answers to "what is it carrying", whether it is the accessory or the prop.
    for (const bag of ['Everyday Bag', 'Tote Bag']) {
        assert.deepEqual(changeCharacterPick({ accessories: 'Tiny Handbag', hair: 'Perm' }, 'everyday_accessories', bag), { hair: 'Perm', everyday_accessories: bag });
        assert.deepEqual(changeCharacterPick({ accessories: 'Impossible Handbag' }, 'everyday_accessories', bag), { everyday_accessories: bag });
        assert.deepEqual(changeCharacterPick({ distinctive_features: 'Impossible Handbag', hair: 'Perm' }, 'everyday_accessories', bag), { hair: 'Perm', everyday_accessories: bag });
        assert.deepEqual(changeCharacterPick({ everyday_accessories: bag }, 'accessories', 'Tiny Handbag'), { accessories: 'Tiny Handbag' });
        assert.deepEqual(changeCharacterPick({ everyday_accessories: bag }, 'distinctive_features', 'Impossible Handbag'), { distinctive_features: 'Impossible Handbag' });
        // Other props and accessories can stay beside a bag.
        assert.deepEqual(changeCharacterPick({ accessories: 'Tiny Teacup', distinctive_features: 'Giant Comb' }, 'everyday_accessories', bag),
            { accessories: 'Tiny Teacup', distinctive_features: 'Giant Comb', everyday_accessories: bag });
    }
    assert.deepEqual(changeCharacterPick({ accessories: 'Tiny Handbag' }, 'everyday_accessories', 'Jewellery'), { accessories: 'Tiny Handbag', everyday_accessories: 'Jewellery' });
    // The beetle helmet covers the head and face, so a hat, headphones or everyday eyewear cannot go on top of it.
    for (const hat of labels('headwear')) {
        assert.deepEqual(changeCharacterPick({ accessories: 'Bug Head Mask', hair: 'Bald' }, 'headwear', hat), { hair: 'Bald', headwear: hat });
        assert.deepEqual(changeCharacterPick({ headwear: hat }, 'accessories', 'Bug Head Mask'), { accessories: 'Bug Head Mask' });
    }
    for (const glasses of ['Glasses', 'Round Glasses', 'Sunglasses']) {
        assert.deepEqual(changeCharacterPick({ accessories: 'Bug Head Mask' }, 'everyday_accessories', glasses), { everyday_accessories: glasses });
        assert.deepEqual(changeCharacterPick({ everyday_accessories: glasses }, 'accessories', 'Bug Head Mask'), { accessories: 'Bug Head Mask' });
    }
    assert.deepEqual(changeCharacterPick({ accessories: 'Bug Head Mask' }, 'everyday_accessories', 'Jewellery'), { accessories: 'Bug Head Mask', everyday_accessories: 'Jewellery' });
});

test('resolveExclusivePicks settles every contradictory pair the same way, without touching its input', () => {
    // Every pair, with every value on both sides: the everyday explicit choice stays, the surreal one goes.
    const pairs = [
        ...labels('brows').flatMap((brows) => [['brows', brows, 'face_features', 'Tiny Brows'], ['brows', brows, 'face_features', 'One Brow'], ['brows', brows, 'accessories', 'Chrome Brows']]),
        ...['Glasses', 'Round Glasses', 'Sunglasses'].flatMap((glasses) => [
            ['everyday_accessories', glasses, 'accessories', 'Tiny Sunglasses'], ['everyday_accessories', glasses, 'accessories', 'Tiny Monocle'], ['everyday_accessories', glasses, 'accessories', 'Bug Head Mask'],
        ]),
        ...['Everyday Bag', 'Tote Bag'].flatMap((bag) => [
            ['everyday_accessories', bag, 'accessories', 'Tiny Handbag'], ['everyday_accessories', bag, 'accessories', 'Impossible Handbag'], ['everyday_accessories', bag, 'distinctive_features', 'Impossible Handbag'],
        ]),
        ...labels('headwear').map((hat) => ['headwear', hat, 'accessories', 'Bug Head Mask']),
    ];
    for (const [keepKey, keep, dropKey, drop] of pairs) {
        const picks = Object.freeze({ [keepKey]: keep, [dropKey]: drop, hair: 'Perm' });
        assert.deepEqual(resolveExclusivePicks(picks), { [keepKey]: keep, hair: 'Perm' }, `${keep} beats ${drop}`);
        assert.deepEqual(sanitizeOddlingPicks(picks), { [keepKey]: keep, hair: 'Perm' }, `a saved passport holding ${keep} and ${drop} is settled when read`);
    }
    // Pairs that are not contradictions stay as they are.
    for (const picks of [
        { brows: 'Thick', face_features: 'Huge Lashes' },
        { everyday_accessories: 'Jewellery', accessories: 'Tiny Sunglasses' },
        { everyday_accessories: 'Jewellery', accessories: 'Bug Head Mask' },
        { everyday_accessories: 'Everyday Bag', accessories: 'Tiny Teacup', distinctive_features: 'Giant Comb' },
        { headwear: 'Beanie', accessories: 'Tiny Sunglasses' },
        { accessories: 'Chrome Brows', face_features: 'Tiny Brows' },
    ]) assert.deepEqual(resolveExclusivePicks(picks), picks);
    // Junk neither wins nor loses, and a missing object is fine.
    assert.deepEqual(resolveExclusivePicks({ brows: 'thick', face_features: 'Tiny Brows' }), { brows: 'thick', face_features: 'Tiny Brows' });
    assert.deepEqual(resolveExclusivePicks({ brows: '', face_features: 'Tiny Brows' }), { brows: '', face_features: 'Tiny Brows' });
    assert.deepEqual(resolveExclusivePicks(undefined), {});
    assert.deepEqual(resolveExclusivePicks(null), {});
});

test('a prompt never carries both halves of a contradiction, even for picks that skipped changeCharacterPick', () => {
    const both = {
        brows: 'Thick', face_features: 'One Brow', everyday_accessories: 'Sunglasses', accessories: 'Tiny Monocle',
    };
    const prompt = buildCharacterPrompt('', both);
    assert.ok(prompt.includes(phrase('brows', 'Thick')) && prompt.includes(phrase('everyday_accessories', 'Sunglasses')));
    assert.ok(!prompt.includes(phrase('face_features', 'One Brow')));
    assert.ok(!prompt.includes(phrase('accessories', 'Tiny Monocle')));
    assert.deepEqual(characterTraits(both), [phrase('brows', 'Thick'), phrase('everyday_accessories', 'Sunglasses')]);
    // The helmet gives way to a hat but not to a different surreal accessory.
    assert.ok(!buildCharacterPrompt('', { headwear: 'Beanie', accessories: 'Bug Head Mask' }).includes('jewel-beetle'));
    assert.ok(buildCharacterPrompt('', { headwear: 'Beanie', accessories: 'Tiny Teacup' }).includes('miniature porcelain teacup'));
});

test('Remix styling over brows, glasses, a bag or a hat never builds a prompt with contradictory pairs', () => {
    const SURREAL_BROWS = [phrase('face_features', 'Tiny Brows'), phrase('face_features', 'One Brow'), phrase('accessories', 'Chrome Brows')];
    const SURREAL_EYEWEAR = [phrase('accessories', 'Tiny Sunglasses'), phrase('accessories', 'Tiny Monocle')];
    const SURREAL_BAGS = [phrase('accessories', 'Tiny Handbag'), phrase('accessories', 'Impossible Handbag'), phrase('distinctive_features', 'Impossible Handbag')];
    const HELMET = phrase('accessories', 'Bug Head Mask');
    const cases = [
        { seed: { brows: 'Thick', everyday_accessories: 'Glasses' }, kept: [phrase('brows', 'Thick'), phrase('everyday_accessories', 'Glasses')], banned: [...SURREAL_BROWS, ...SURREAL_EYEWEAR, HELMET] },
        { seed: { brows: 'Arched', everyday_accessories: 'Sunglasses', headwear: 'Beanie' }, kept: [phrase('everyday_accessories', 'Sunglasses'), phrase('headwear', 'Beanie')], banned: [...SURREAL_BROWS, ...SURREAL_EYEWEAR, HELMET] },
        { seed: { everyday_accessories: 'Tote Bag' }, kept: [phrase('everyday_accessories', 'Tote Bag')], banned: SURREAL_BAGS },
        { seed: { headwear: 'Bucket Hat' }, kept: [phrase('headwear', 'Bucket Hat')], banned: [HELMET] },
    ];
    for (const { seed, kept, banned } of cases) {
        const rolled = { accessories: new Set(), face_features: new Set() };
        for (let step = 0; step <= 200; step += 1) {
            const remixed = randomizeOddlingStyle({ character_type: 'Human', ...seed }, () => step / 200);
            for (const key of Object.keys(rolled)) rolled[key].add(remixed[key]);
            for (const [key, value] of Object.entries(seed)) assert.equal(remixed[key], value, `Remix keeps the ${key} it was given`);
            const prompt = buildCharacterPrompt('', remixed);
            for (const text of kept) assert.ok(prompt.includes(text), `roll ${step}: ${text} is kept`);
            for (const text of banned) assert.ok(!prompt.includes(text), `roll ${step}: "${text}" contradicts ${JSON.stringify(seed)}`);
            const saved = sanitizeOddlingPicks(remixed);
            assert.deepEqual(saved, resolveExclusivePicks(saved), `roll ${step}: a saved Remix is already settled`);
        }
        // The sweep really does roll the contradicting options, so the assertions above are not vacuous.
        assert.ok(['Tiny Brows', 'One Brow'].some((value) => rolled.face_features.has(value)), 'a sweep rolls the surreal brow details');
        assert.ok(['Tiny Sunglasses', 'Tiny Monocle', 'Tiny Handbag', 'Impossible Handbag', 'Chrome Brows', 'Bug Head Mask'].some((value) => rolled.accessories.has(value)));
    }
    const rolls = new Set();
    for (let step = 0; step <= 200; step += 1) rolls.add(randomizeOddlingStyle({ character_type: 'Human', brows: 'Thick', everyday_accessories: 'Glasses' }, () => step / 200).accessories);
    for (const value of ['Tiny Sunglasses', 'Tiny Monocle', 'Chrome Brows', 'Bug Head Mask']) assert.ok(rolls.has(value), `the sweep rolls ${value}`);
});

const archetype = (id) => ODDLING_ARCHETYPES.find((item) => item.id === id);
const withPick = (id, key, value) => changeCharacterPick(archetype(id).picks, key, value);

test('swapping a cast preset accessory also takes its description out of the preset canon', () => {
    // A tote bag replaces a tiny silver handbag, and the canon no longer holds the handbag.
    const duchess = buildCharacterPrompt('', withPick('duchess-volume', 'everyday_accessories', 'Tote Bag'));
    assert.ok(duchess.includes('carrying a canvas tote bag'));
    assert.doesNotMatch(duchess, /handbag/i);
    assert.ok(duchess.includes('tiny crown'), 'the rest of the canon stays');
    for (const [id, bagClause] of [['olive-orbit', 'tiny silver orb handbag'], ['taffy-tessa', 'tiny violet handbag']]) {
        const prompt = buildCharacterPrompt('', withPick(id, 'everyday_accessories', 'Everyday Bag'));
        assert.ok(prompt.includes('ordinary everyday shoulder bag') && !prompt.includes(bagClause) && !/handbag/i.test(prompt), id);
    }
    // Everyday sunglasses replace tiny sunglasses in the picks and in the canon.
    for (const id of ['pam-bouffant', 'cloudette-forecast', 'brick-picnic']) {
        const prompt = buildCharacterPrompt('', withPick(id, 'everyday_accessories', 'Sunglasses'));
        assert.ok(prompt.includes('wearing regular-sized sunglasses'), id);
        assert.doesNotMatch(prompt, /tiny (oval )?sunglasses/i, id);
    }
    assert.doesNotMatch(buildCharacterPrompt('', withPick('baron-boucle', 'everyday_accessories', 'Round Glasses')), /monocle/i);
    // Glasses added to a preset that already has round glasses replace them rather than doubling up.
    const major = buildCharacterPrompt('', withPick('major-minor', 'everyday_accessories', 'Glasses'));
    assert.ok(major.includes('everyday glasses at a normal scale') && !major.includes('round glasses'));
    // A hat or glasses replaces the beetle helmet in the picks and the canon.
    for (const [key, value] of [['headwear', 'Beanie'], ['everyday_accessories', 'Sunglasses']]) {
        const prompt = buildCharacterPrompt('', withPick('bughead-brenda', key, value));
        // The free-text premise ("dinner parties in a huge helmet") is the user's own words and is left alone.
        assert.doesNotMatch(prompt, /jewel-beetle|fashion helmet/i, `${key}/${value}`);
        assert.ok(prompt.includes('orange utility jumpsuit'), 'the rest of the canon stays');
    }
    // Brows replace Chrome Brows in the picks and the canon.
    const tuesday = buildCharacterPrompt('', withPick('tuesday-triangle', 'brows', 'Bushy'));
    assert.ok(tuesday.includes('bushy untamed eyebrows') && !/chrome (lacquer )?eyebrows/i.test(tuesday), 'Chrome Brows give way to chosen brows');
    // Picks that do not touch the preset's own accessory leave its canon alone.
    assert.ok(buildCharacterPrompt('', withPick('major-minor', 'everyday_accessories', 'Jewellery')).includes('round glasses'));
    assert.ok(buildCharacterPrompt('', withPick('duchess-volume', 'headwear', 'Beanie')).includes('miniature silver handbag'));
    assert.ok(buildCharacterPrompt('', withPick('pam-bouffant', 'everyday_accessories', 'Tote Bag')).includes('tiny sunglasses'));
    assert.ok(buildCharacterPrompt('', archetype('pam-bouffant').picks).includes('tiny sunglasses'));
    // The same holds for picks that skipped changeCharacterPick, such as a Remix over a preset.
    const remixedPam = buildCharacterPrompt('', { ...archetype('pam-bouffant').picks, everyday_accessories: 'Sunglasses' });
    assert.ok(remixedPam.includes('wearing regular-sized sunglasses'));
    assert.doesNotMatch(remixedPam, /tiny (oval )?sunglasses/i);
});

test('the groups the Studio does not show yet are a recorded gap, so they cannot be forgotten or half-wired', () => {
    // Update this list when the Studio sections gain these groups (app/veyrnox/_lib/oddlingStudio.js):
    // exaggeration -> Character signal; brows, nose_shape, cheeks, lips, chin_jaw -> Face details; headwear, everyday_accessories -> Style world.
    const STUDIO_GAP = ['exaggeration', 'brows', 'nose_shape', 'cheeks', 'lips', 'chin_jaw', 'headwear', 'everyday_accessories'];
    const shown = new Set(ODDLING_STUDIO_SECTIONS.flatMap(({ groupIds }) => groupIds));
    const missing = CHARACTER_GROUPS.map(({ id }) => id).filter((id) => !shown.has(id));
    assert.deepEqual(missing, STUDIO_GAP, 'the Studio gap changed: update STUDIO_GAP in this test along with the sections');
    assert.deepEqual(STUDIO_GAP, CHARACTER_NEW_GROUPS.map(({ id }) => id));
    for (const section of ODDLING_STUDIO_SECTIONS) for (const id of section.groupIds) assert.ok(group(id), `${section.id} lists a real group: ${id}`);
});

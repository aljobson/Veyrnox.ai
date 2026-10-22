import test from 'node:test';
import assert from 'node:assert/strict';
import * as web from '../lib/creatorWords.js';
import { CREATOR_ANSWERS } from '../lib/creatorProfile.js';
// Node strips the type annotations; the phone's file is self-contained for this reason.
import * as mobile from '../apps/mobile/src/lib/creatorWords.ts';

const texts = ['Product spin on a pedestal', 'Neon rain night alley, cyber', 'A lullaby for kids at bedtime', 'meme reaction viral', '  AD  ', 'Quiet lake', '', 'Documentary gritty street handheld raw'];

test('the phone and the web use the same words and weights', () => {
    assert.deepEqual(JSON.parse(JSON.stringify(mobile.GOAL_WORDS)), JSON.parse(JSON.stringify(web.GOAL_WORDS)));
    assert.deepEqual(JSON.parse(JSON.stringify(mobile.LOOK_WORDS)), JSON.parse(JSON.stringify(web.LOOK_WORDS)));
    assert.equal(mobile.GOAL_WEIGHT, web.GOAL_WEIGHT);
    assert.equal(mobile.LOOK_WEIGHT, web.LOOK_WEIGHT);
    assert.equal(mobile.MAX_HITS, web.MAX_HITS);
});

test('every goal and look the interview offers has words, and nothing else does', () => {
    assert.deepEqual(Object.keys(web.GOAL_WORDS).sort(), [...CREATOR_ANSWERS.goal].sort());
    assert.deepEqual(Object.keys(web.LOOK_WORDS).sort(), [...CREATOR_ANSWERS.look].sort());
});

test('both score every text the same for every goal and look', () => {
    for (const goal of CREATOR_ANSWERS.goal) for (const look of CREATOR_ANSWERS.look) for (const text of texts) {
        assert.equal(mobile.tasteScoreText(text, { goal, look }), web.tasteScoreText(text, { goal, look }), `${goal}/${look}/${text}`);
    }
    for (const bad of [null, undefined, 5, 'x', {}, { goal: '__proto__', look: 'constructor' }, { goal: 'toString' }]) {
        assert.equal(mobile.tasteScoreText('product neon', bad), web.tasteScoreText('product neon', bad), JSON.stringify(bad));
        assert.equal(web.tasteScoreText('product neon', bad), 0);
    }
});

test('a few matching words count and a flood does not', () => {
    const stuffed = 'product product ad brand sale shop commercial neon rain cyber night';
    assert.equal(web.tasteScoreText(stuffed, { goal: 'sell', look: 'neon_rain' }), 3 * 2 + 1 * 2);
});

test('ranking puts fits first, keeps ties in order, never drops or adds, and does nothing without answers', () => {
    const list = [{ n: 'Quiet lake' }, { n: 'Product spin' }, { n: 'Meme reaction' }, { n: 'Neon product ad' }];
    const textOf = (x) => x.n;
    assert.deepEqual(web.rankByTaste(list, { goal: 'sell', look: 'neon_rain' }, textOf).map((x) => x.n), ['Neon product ad', 'Product spin', 'Quiet lake', 'Meme reaction']);
    assert.deepEqual(web.rankByTaste(list, null, textOf), list);
    assert.notEqual(web.rankByTaste(list, null, textOf), list, 'a copy');
    assert.equal(list[0].n, 'Quiet lake', 'the input is untouched');
});

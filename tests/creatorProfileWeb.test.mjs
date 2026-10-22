import test from 'node:test';
import assert from 'node:assert/strict';
import { readVibe } from '../app/veyrnox/_lib/creatorProfile.js';
import { PRESETS } from '../app/veyrnox/_lib/tokens.js';
import { rankByTaste } from '../lib/creatorWords.js';

const good = { look: 'neon_rain', goal: 'sell', pace: 'fox', chaos: 3, destination: 'tiktok', audience: 'customers', voice: 'calm' };

test('the server body maps to a status; anything unreadable is "unavailable"', () => {
    assert.deepEqual(readVibe({ status: 'none' }), { status: 'none', answers: null });
    assert.deepEqual(readVibe({ status: 'skipped', answers: {} }), { status: 'skipped', answers: null });
    assert.deepEqual(readVibe({ status: 'completed', answers: good }), { status: 'completed', answers: good });
    for (const bad of [null, undefined, 'x', [], {}, { status: 'completed' }, { status: 'completed', answers: { ...good, look: 'sepia' } }, { status: 'other' }]) {
        assert.deepEqual(readVibe(bad), { status: 'unavailable', answers: null }, JSON.stringify(bad));
    }
});

test('answers read back are cleaned: unknown keys never reach the page', () => {
    const r = readVibe({ status: 'completed', answers: { ...good, studio_name: '  Night Owl  ' } });
    assert.equal(r.answers.studio_name, 'Night Owl');
    assert.equal(readVibe({ status: 'completed', answers: { ...good, is_admin: true } }).status, 'unavailable');
});

test('ranking the real template list keeps every template exactly once and leads with a fit', () => {
    const textOf = (p) => `${p.name} ${p.category} ${p.prompt}`;
    const ranked = rankByTaste(PRESETS, good, textOf);
    assert.equal(ranked.length, PRESETS.length);
    assert.equal(new Set(ranked.map((p) => p.id)).size, PRESETS.length);
    assert.deepEqual(rankByTaste(PRESETS, null, textOf).map((p) => p.id), PRESETS.map((p) => p.id));
});

test('the web card, worded from the English catalog, reads exactly like the shared English card', async () => {
  const { default: en } = await import('../lib/i18n/messages/app/en.mjs');
  const { archetypeParts, archetypeName, creatorCard } = await import('../lib/creatorArchetype.js');
  const { CREATOR_ANSWERS } = await import('../lib/creatorProfile.js');
  const fill = (text, vars = {}) => text.replace(/\{(\w+)\}/g, (_, k) => vars[k]);
  for (const pace of CREATOR_ANSWERS.pace) for (const look of CREATOR_ANSWERS.look) for (const destination of CREATOR_ANSWERS.destination) {
    for (let chaos = 0; chaos <= 4; chaos++) {
      const a = { ...good, pace, look, destination, chaos };
      const p = archetypeParts(a);
      const name = fill(en['app.vibe.card.name'], { adjective: en[`app.vibe.card.adj.${p.adjective}`], noun: en[`app.vibe.card.noun.${p.pace ?? 'maker'}`] });
      assert.equal(name, archetypeName(a));
      // The chips share the catalog's wording for look and chaos; the destination chip says "Camera roll" in the shared card and the question's full wording here.
      assert.equal(en[`app.vibe.look.${p.look}`], creatorCard(a).traits[0]);
      assert.equal(en[`app.vibe.chaos.${p.chaos}`], creatorCard(a).traits[1]);
    }
  }
  assert.equal(fill(en['app.vibe.card.name'], { adjective: en['app.vibe.card.adj.1'], noun: en['app.vibe.card.noun.maker'] }), archetypeName({}));
});

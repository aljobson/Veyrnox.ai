import test from 'node:test';
import assert from 'node:assert/strict';
import { ODDLING_ARCHETYPES } from '../app/veyrnox/_lib/character.js';
import { ODDLING_KNOWLEDGE } from '../lib/oddlingKnowledge.js';
import { productKnowledgeContext, searchProductKnowledge } from '../lib/productKnowledge.js';
import { fallbackHelpPlan } from '../lib/productHelpFallback.js';
import { createHelpPlan } from '../lib/helpAssistant.js';

test('every live cast member is discoverable by name from any workspace', () => {
  for (const character of ODDLING_ARCHETYPES) {
    for (const route of ['/app', '/app/create', '/app/oddlings']) {
      const entry = searchProductKnowledge(`Tell me about ${character.name}`, route, 1)[0];
      assert.equal(entry.id, `oddling-${character.id}`);
      assert.ok(entry.summary.includes(character.hook));
      assert.ok(entry.facts.join(' ').includes(character.picks.oddling_rule));
    }
    assert.ok(fallbackHelpPlan(`Who is ${character.name}?`, '/app').message.includes(character.hook));
  }
});

test('Odd character synonyms retrieve the roster and keep private passports distinct', () => {
  for (const question of ['What are the Odd characters?', 'Which Oddlings can I choose?', 'Show me the character roster']) {
    assert.equal(searchProductKnowledge(question, '/app', 1)[0].id, 'oddling-roster');
  }
  const roster = ODDLING_KNOWLEDGE.find(({ id }) => id === 'oddling-roster');
  for (const { name } of ODDLING_ARCHETYPES) assert.ok(roster.summary.includes(name));
  assert.match(roster.facts.join(' '), /cannot see private browser-local passports/);
  const context = productKnowledgeContext(ODDLING_ARCHETYPES.map(({ name }) => name).join(' '), '/app/oddlings');
  assert.ok(context.length < 9000);
});

test('asking about a different cast member replaces the previous subject', () => {
  const result = fallbackHelpPlan('Tell me about Auntie Antenna', '/app/oddlings', [
    { role: 'user', content: 'Who is Bughead Brenda?' },
  ]);
  assert.match(result.message, /Auntie Antenna: A velvet moth oracle/);
  assert.doesNotMatch(result.message, /Bughead Brenda/);
});

test('Vey provider request receives source-derived character canon', async () => {
  let request;
  await createHelpPlan({
    question: 'Who is Bughead Brenda?', pathname: '/app/create',
    env: { OPENROUTER_HELP_API_KEY: 'test-only' },
    fetchImpl: async (_url, init) => {
      request = JSON.parse(init.body);
      return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ message: 'A human etiquette coach with an enormous beetle mask.', target: 'oddlings.builder', action: 'show_target' }) } }] }) };
    },
  });
  assert.match(request.messages[0].content, /enormous iridescent jewel-beetle fashion helmet/);
  assert.match(request.messages[0].content, /ordinary human body and hands/);
});

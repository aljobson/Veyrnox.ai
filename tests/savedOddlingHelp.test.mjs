import test from 'node:test';
import assert from 'node:assert/strict';
import { publicHelpHistory, savedOddlingHelp } from '../lib/savedOddlingHelp.js';
import { ODDLING_LIBRARY_KEY } from '../app/veyrnox/_lib/oddlingStudio.js';
const passport = (id, name = 'Mira Moon') => ({ id, savedAt: 1000, picks: { oddling_name: name, oddling_voice: 'Dry oracle', oddling_rule: 'Silver coat and copper glasses', oddling_show: 'Impossible weather', hair: 'Sharp Bob' } });
const storage = (items) => ({ getItem: (key) => key === ODDLING_LIBRARY_KEY ? JSON.stringify(items) : null, setItem: () => assert.fail('help must not write storage') });

test('saved names resolve to actual browser-local values, without calling a provider', () => {
  const plan = savedOddlingHelp('Who is Mira Moon? Describe her canon', storage([passport('one')]));
  assert.equal(plan.source, 'local');
  assert.equal(plan.localOnly, true);
  assert.equal(plan.savedOddlingId, 'one');
  assert.match(plan.message, /Silver coat and copper glasses/);
  assert.match(plan.message, /Load and edit/);
  assert.equal(plan.action, 'show_target');
});
test('duplicate names require a deliberate version selection', () => {
  const store = storage([passport('one'), passport('two')]);
  const plan = savedOddlingHelp('Use Mira Moon', store);
  assert.equal(plan.savedOddlingId, undefined);
  assert.equal(plan.savedChoices.length, 2);
  assert.match(plan.message, /will not guess/);
  assert.equal(savedOddlingHelp('Use this saved passport', store, { selectedId: 'two' }).savedOddlingId, 'two');
});
test('guidance advances from History to prompt and Continue without activating either', () => {
  const store = storage([passport('one')]);
  assert.equal(savedOddlingHelp('Show her prompt', store, { previousId: 'one', loadedId: 'one' }).target, 'oddlings.prompt');
  const next = savedOddlingHelp('next', store, { previousId: 'one', loadedId: 'one' });
  assert.equal(next.target, 'oddlings.continue');
  assert.equal(next.action, 'show_target');
  assert.equal(savedOddlingHelp('next', store, { previousId: 'one', pathname: '/app/create' }).target, 'create.cost');
  assert.equal(savedOddlingHelp('How do I use Web search?', store, { previousId: 'one' }), null);
});
test('private saved conversation is omitted from subsequent public help requests', () => {
  assert.deepEqual(publicHelpHistory([
    { role: 'user', content: 'Use Mira Moon', localOnly: true },
    { role: 'assistant', content: 'Private canon', localOnly: true },
    { role: 'user', content: 'How do Credits work?' },
    { role: 'assistant', content: 'Loading', pending: true },
  ]), [{ role: 'user', content: 'How do Credits work?' }]);
});
test('missing, deleted, corrupt and blocked local storage never invents characters', () => {
  for (const store of [storage([]), storage([{ ...passport('bad-date'), savedAt: 1e30 }]), { getItem: () => '{bad json' }, { getItem: () => { throw Error('blocked'); } }]) {
    const plan = savedOddlingHelp('Where are my saved Oddlings?', store, { previousId: 'deleted' });
    assert.match(plan.message, /no saved Oddling passports/i);
    assert.equal(plan.savedChoices.length, 0);
  }
});
test('saved custom characters are not replaced by built-in animation portraits', () => {
  const result = savedOddlingHelp('Animate Mira Moon', storage([passport('one')]));
  assert.match(result.message, /Create a portrait first/);
  assert.match(result.message, /do not substitute a built-in cast portrait/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { BEAT_TIP_STEPS, beatTipsSeenKey, beatTipsSeen, markBeatTipsSeen, createBeatTipSession } from '../app/veyrnox/_lib/music/beat/beatCoachMarks.mjs';
function setup(blocker) {
  let focused = 0, restored = 0, shown, discovered = 0;
  const elements = BEAT_TIP_STEPS.map(() => ({ getBoundingClientRect: () => ({ top: 10, left: 10, bottom: 50, right: 50, width: 40, height: 40 }), getClientRects: () => [1] }));
  const blocks = blocker ? [blocker] : [];
  const storage = new Map(); storage.getItem = storage.get.bind(storage); storage.setItem = storage.set.bind(storage);
  const doc = { activeElement: { isConnected: true, focus: () => restored++ }, querySelectorAll(selector) {
    if (selector.startsWith('[data-feature-tour]')) return blocks;
    discovered++; return [elements[BEAT_TIP_STEPS.findIndex(step => step.selector === selector)]];
  } };
  const session = createBeatTipSession({ doc, viewport: () => ({ width: 375, height: 700 }), storage, userId: 'one', show: value => { shown = value; }, focusPrimary: () => focused++ });
  return { session, blocks, elements, storage, get state() { return { focused, restored, shown, discovered }; } };
}
const block = kind => ({ hasAttribute: name => kind === 'tour' && name === 'data-feature-tour', matches: () => ['native', 'walkthrough'].includes(kind), getClientRects: () => [1], getBoundingClientRect: () => ({ width: 375, height: 700 }) });
for (const kind of ['auth', 'native', 'walkthrough', 'tour']) test(`${kind} blocks discovery, focus and Escape until closed`, () => {
  const f = setup(block(kind)); f.session.update();
  assert.equal(f.state.discovered, 0); assert.equal(f.state.focused, 0);
  f.session.escape({ key: 'Escape', preventDefault() { assert.fail('must not consume blocker Escape'); } });
  f.session.next(); f.session.skip(); assert.equal(f.storage.size, 0);
  f.blocks.length = 0; f.session.update(); assert.equal(f.state.shown.index, 0); assert.equal(f.state.focused, 1);
  f.session.skip(); assert.equal(f.state.restored, 1); assert.equal(f.storage.get(beatTipsSeenKey('one')), '1');
});
test('coach-first startup hides and preserves its step when FeatureTour appears, then resumes', () => {
  const f = setup(); f.session.update(); f.session.next(); assert.equal(f.state.shown.index, 1);
  f.blocks.push(block('tour')); const before = f.state;
  f.session.update(); assert.equal(f.state.shown, null); assert.equal(f.state.focused, before.focused); assert.equal(f.state.discovered, before.discovered);
  f.session.next(); f.blocks.length = 0; f.session.update(); assert.equal(f.state.shown.index, 1);
  let prevented = 0; f.session.escape({ key: 'Escape', preventDefault() { prevented++; }, stopPropagation() {} });
  assert.equal(prevented, 1); assert.equal(f.state.restored, 1);
});
test('offscreen targets skip; device keys isolate people and storage refusal is harmless', () => {
  const f = setup(); f.elements[0].getBoundingClientRect = () => ({ top: 800, bottom: 840, left: 0, right: 40, width: 40, height: 40 });
  f.session.update(); assert.equal(f.state.shown.index, 1);
  f.session.skip(); assert.equal(beatTipsSeen(f.storage, 'one'), true); assert.equal(beatTipsSeen(f.storage, 'two'), false);
  const broken = { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); } };
  assert.equal(beatTipsSeen(broken, 'one'), false); assert.doesNotThrow(() => markBeatTipsSeen(broken, 'one'));
  assert.equal(beatTipsSeen(broken, null), true);
});

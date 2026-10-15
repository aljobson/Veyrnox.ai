import test from 'node:test';
import assert from 'node:assert/strict';
import { optionsForReplyMode, REPLY_MODES, replyMode } from '../app/veyrnox/_lib/chatComposer.js';

test('the active reply mode has a stable priority', () => {
  assert.equal(replyMode({}), REPLY_MODES.STANDARD);
  assert.equal(replyMode({ thinking: true }), REPLY_MODES.THINKING);
  assert.equal(replyMode({ thinking: true, research: true }), REPLY_MODES.RESEARCH);
});

test('standard and thinking preserve web search while deep research stands alone', () => {
  assert.deepEqual(optionsForReplyMode(REPLY_MODES.STANDARD, { thinking: true, web: true, research: false }), { thinking: false, web: true, research: false });
  assert.deepEqual(optionsForReplyMode(REPLY_MODES.THINKING, { thinking: false, web: true, research: false }), { thinking: true, web: true, research: false });
  assert.deepEqual(optionsForReplyMode(REPLY_MODES.RESEARCH, { thinking: true, web: true, research: false }), { thinking: false, web: false, research: true });
});

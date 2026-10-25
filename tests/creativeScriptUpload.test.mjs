import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CREATIVE_SCRIPT_MAX_BYTES,
  creativeScriptFileProblem,
  readCreativeScriptFile,
} from '../app/veyrnox/_lib/creativeScriptUpload.mjs';

const scriptFile = (overrides = {}) => ({
  name: 'voiceover.txt',
  size: 12,
  type: 'text/plain',
  async text() { return 'A concise voiceover.'; },
  ...overrides,
});

test('script uploads accept TXT and Markdown and return trimmed text', async () => {
  assert.equal(creativeScriptFileProblem(scriptFile()), '');
  assert.equal(creativeScriptFileProblem(scriptFile({ name: 'voiceover.md', type: 'text/markdown' })), '');
  assert.deepEqual(await readCreativeScriptFile(scriptFile({ async text() { return '  Speak clearly.  '; } })), {
    problem: '',
    text: 'Speak clearly.',
  });
});

test('script uploads reject unsupported, empty, oversized and overlong files', async () => {
  assert.equal(creativeScriptFileProblem(null), 'missing');
  assert.equal(creativeScriptFileProblem(scriptFile({ name: 'voiceover.pdf', type: 'application/pdf' })), 'type');
  assert.equal(creativeScriptFileProblem(scriptFile({ size: 0 })), 'empty');
  assert.equal(creativeScriptFileProblem(scriptFile({ size: CREATIVE_SCRIPT_MAX_BYTES + 1 })), 'size');
  assert.deepEqual(await readCreativeScriptFile(scriptFile({ async text() { return ' '.repeat(10); } })), { problem: 'empty', text: '' });
  assert.deepEqual(await readCreativeScriptFile(scriptFile({ async text() { return 'x'.repeat(1001); } })), { problem: 'length', text: '' });
});

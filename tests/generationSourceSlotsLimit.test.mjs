import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_SLOT_FILES } from '../lib/multiReference.mjs';
import { publicSlotMax } from '../lib/generationSourceSlots.mjs';

test('the slot ceiling in generationSourceSlots matches multiReference.mjs', () => {
  assert.equal(publicSlotMax({ maxFiles: MAX_SLOT_FILES + 5 }), MAX_SLOT_FILES);
});

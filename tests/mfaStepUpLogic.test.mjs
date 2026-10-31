import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_ATTEMPTS, VERIFIED, needsStepUp, pickFactorId, isLockedOut } from '../app/lib/mfaStepUp.js';

test('aal1 enrollment selects the first verified factor', () => {
  const factors = [{ id: 'pending', status: 'unverified' }, { id: 'first', status: VERIFIED }, { id: 'second', status: VERIFIED }];
  assert.equal(needsStepUp('aal1', factors), true);
  assert.equal(pickFactorId(factors), 'first');
});

test('missing and unverified factors do not require step-up', () => {
  for (const factors of [null, undefined, {}, [], [{ id: 'pending', status: 'unverified' }]]) {
    assert.equal(needsStepUp('aal1', factors), false);
    assert.equal(pickFactorId(factors), null);
  }
});

test('aal2 and absent assurance never prompt', () => {
  for (const aal of ['aal2', null]) assert.equal(needsStepUp(aal, [{ id: 'totp', status: VERIFIED }]), false);
});

test('five attempts lock the current sign-in', () => {
  assert.equal(MAX_ATTEMPTS, 5);
  for (let attempts = 0; attempts < MAX_ATTEMPTS; attempts++) assert.equal(isLockedOut(attempts), false);
  assert.equal(isLockedOut(MAX_ATTEMPTS), true);
  assert.equal(isLockedOut(MAX_ATTEMPTS + 1), true);
});

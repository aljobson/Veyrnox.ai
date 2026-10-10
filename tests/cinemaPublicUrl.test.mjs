import test from 'node:test';
import assert from 'node:assert/strict';
import { publicCinemaUrl } from '../lib/cinema/publicUrl.js';
const id = '11111111-ABCD-4111-8111-111111111111';
test('public Cinema shares carry only a validated canonical title or episode UUID', () => {
  assert.equal(publicCinemaUrl(id), `https://veyrnox.ai/social-cinema/title/${id.toLowerCase()}`);
  assert.equal(publicCinemaUrl(id, true), `https://veyrnox.ai/social-cinema/watch/${id.toLowerCase()}`);
  for (const value of [null, {}, '', `https://evil.invalid/${id}`, `${id}?token=private`, `${id}#private`, '../account', 'signed.stream.token']) assert.equal(publicCinemaUrl(value), null);
});

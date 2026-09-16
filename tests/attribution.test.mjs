import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAttribution, ATTRIBUTION_PARAMS } from '../app/veyrnox/_lib/utm.js';

test('a plain visit records nothing', () => {
  assert.equal(parseAttribution('', ''), null);
  assert.equal(parseAttribution('?page=2', ''), null);
});

test('utm parameters are captured', () => {
  const entry = parseAttribution('?utm_source=reddit&utm_medium=social&utm_campaign=launch');
  assert.deepEqual(entry.params, {
    utm_source: 'reddit',
    utm_medium: 'social',
    utm_campaign: 'launch',
  });
  assert.match(entry.landedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('ad click ids count as attribution', () => {
  assert.deepEqual(parseAttribution('?gclid=abc123').params, { gclid: 'abc123' });
  assert.deepEqual(parseAttribution('?fbclid=xyz').params, { fbclid: 'xyz' });
});

test('unlisted parameters are ignored', () => {
  const entry = parseAttribution('?utm_source=x&token=secret&password=hunter2');
  assert.deepEqual(Object.keys(entry.params), ['utm_source']);
});

test('an oversized value is truncated rather than stored whole', () => {
  const entry = parseAttribution(`?utm_campaign=${'a'.repeat(500)}`);
  assert.equal(entry.params.utm_campaign.length, 128);
});

test('an off-site referrer is kept alongside the params', () => {
  const entry = parseAttribution('?utm_source=hn', 'https://news.ycombinator.com/item?id=1');
  assert.equal(entry.referrer, 'https://news.ycombinator.com/item?id=1');
});

test('every declared param is actually read', () => {
  for (const key of ATTRIBUTION_PARAMS) {
    const entry = parseAttribution(`?${key}=value`);
    assert.ok(entry, `${key} should be captured`);
    assert.equal(entry.params[key], 'value');
  }
});

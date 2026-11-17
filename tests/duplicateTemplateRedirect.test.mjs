import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { DUPLICATE_TEMPLATE_KEEPERS } from '../app/veyrnox/_lib/duplicateTemplateIds.js';
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s,c,next){ return next(s==='next/server'?'next/server.js':s,c); }`));
const { NextRequest } = await import('next/server.js');
const { middleware } = await import('../middleware.js');

// A withdrawn duplicate template (PR 2379) used to answer 200 with a zero-second redirect inside the page, with the title
// "Template not found". The edge now answers a real permanent redirect to the kept template, before any page renders.
const go = path => middleware(new NextRequest(`https://veyrnox.ai${path}`));
const entries = Object.entries(DUPLICATE_TEMPLATE_KEEPERS);

test('every withdrawn duplicate answers 301 to its keeper', async () => {
  assert.equal(entries.length, 13);
  for (const [dup, keeper] of entries) {
    const r = await go(`/presets/${dup}`);
    assert.equal(r.status, 301, dup);
    assert.equal(r.headers.get('location'), `https://veyrnox.ai/presets/${keeper}`, dup);
  }
});

test('language prefix, trailing slash and query string are kept', async () => {
  const [dup, keeper] = entries[0];
  assert.equal((await go(`/fr/presets/${dup}`)).headers.get('location'), `https://veyrnox.ai/fr/presets/${keeper}`);
  assert.equal((await go(`/presets/${dup}/`)).headers.get('location'), `https://veyrnox.ai/presets/${keeper}`);
  assert.equal((await go(`/presets/${dup}?ref=mail&utm_source=x`)).headers.get('location'), `https://veyrnox.ai/presets/${keeper}?ref=mail&utm_source=x`);
});

test('the redirect is cacheable for an hour, not for ever, so a withdrawal can be undone', async () => {
  const r = await go(`/presets/${entries[0][0]}`);
  assert.equal(r.headers.get('cache-control'), 'public, max-age=3600');
});

test('kept templates, unknown ids and other paths are not redirected', async () => {
  for (const path of [`/presets/${entries[0][1]}`, '/presets/not-a-template', '/presets', '/pricing', `/guides/${entries[0][0]}`, `/x/presets/${entries[0][0]}`]) {
    const r = await go(path);
    assert.notEqual(r.status, 301, path);
    assert.notEqual(r.status, 308, path);
  }
});

test('the target is always our own origin and a fixed keeper, never taken from the request', async () => {
  const [dup, keeper] = entries[0];
  for (const path of [`/presets/${dup}`, `//presets/${dup}`, `/presets/${dup}?next=https://evil.example`]) {
    const r = await go(path);
    if (r.status === 301) assert.ok(new URL(r.headers.get('location')).origin === 'https://veyrnox.ai' && new URL(r.headers.get('location')).pathname === `/presets/${keeper}`, path);
  }
});

test('a malformed percent sequence is not a server error', async () => {
  for (const path of ['/presets/%E0%A4%A', '/presets/%', '/fr/presets/%zz']) {
    const r = await go(path);
    assert.notEqual(r.status, 500, path);
    assert.notEqual(r.status, 301, path);
  }
});

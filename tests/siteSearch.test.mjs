import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchIndex, MAX_PER_GROUP, MIN_QUERY } from '../app/veyrnox/_lib/searchIndex.js';
import { SITE_PAGES, PRESETS, FAQ } from '../app/veyrnox/_lib/tokens.js';

const items = [
  { group: 'Pages', title: 'Pricing', detail: 'Every model, every credit price.', href: '/pricing' },
  { group: 'Models', title: 'Wan 2.5', detail: 'text-to-video · 16 cr', href: '/app/create?model=wan-2.5' },
  { group: 'Models', title: 'Nano Banana', detail: 'text-to-image · 3 cr', href: '/app/create?model=nano-banana' },
  { group: 'FAQ', title: 'Do credits expire?', detail: 'Purchased credits never expire.', href: '/#faq' },
];

test('a query shorter than the minimum returns nothing', () => {
  assert.deepEqual(searchIndex(items, 'w'), []);
  assert.deepEqual(searchIndex(items, ' '), []);
  assert.deepEqual(searchIndex(items, ''), []);
  assert.equal(MIN_QUERY, 2);
});

test('matches on the title and ranks a title hit above a detail-only hit', () => {
  const hits = searchIndex(items, 'pricing');
  assert.equal(hits[0].href, '/pricing');

  // "credit" appears in the Pricing detail and in the FAQ title + detail.
  const credit = searchIndex(items, 'credit');
  assert.equal(credit[0].group, 'FAQ', 'title hit outranks detail-only hit');
  assert.ok(credit.some((h) => h.href === '/pricing'));
});

test('a prefix hit outranks the same word mid-title', () => {
  const list = [
    { group: 'Models', title: 'Super Banana', detail: '', href: '/b' },
    { group: 'Models', title: 'Banana Split', detail: '', href: '/a' },
  ];
  assert.equal(searchIndex(list, 'banana')[0].href, '/a');
});

test('no match returns an empty list rather than everything', () => {
  assert.deepEqual(searchIndex(items, 'zzzzz'), []);
});

test('one group cannot crowd out the rest', () => {
  const many = Array.from({ length: 20 }, (_, i) => ({
    group: 'Models',
    title: `Test model ${i}`,
    detail: '',
    href: `/m/${i}`,
  }));
  const hits = searchIndex([...many, { group: 'Pages', title: 'Test page', detail: '', href: '/p' }], 'test');
  assert.equal(hits.filter((h) => h.group === 'Models').length, MAX_PER_GROUP);
  assert.ok(hits.some((h) => h.href === '/p'), 'the Pages hit survives a long Models list');
});

test('the real site index is searchable and every page row has a route', () => {
  const real = [
    ...SITE_PAGES.map((p) => ({ group: 'Pages', title: p.label, detail: p.description, href: p.href })),
    ...PRESETS.map((p) => ({ group: 'Presets', title: p.name, detail: p.category, href: '/presets' })),
    ...FAQ.map((f) => ({ group: 'FAQ', title: f.q, detail: f.a, href: '/#faq' })),
  ];
  assert.ok(searchIndex(real, 'refund').length > 0);
  assert.ok(searchIndex(real, 'preset').length > 0);
  for (const p of SITE_PAGES) {
    assert.match(p.href, /^\//, `${p.label} must be an internal route`);
    assert.ok(p.description, `${p.label} needs a description for search and the 404 page`);
  }
});

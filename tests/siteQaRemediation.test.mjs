import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('mobile Studio has a compact model picker and a visible cost action', () => {
  const src = read('app/veyrnox/app/create/page.js');
  assert.match(src, /<select[\s\S]*id="studio-model"[\s\S]*onChange=\{\(event\) => setModelId\(event\.target\.value\)\}/);
  assert.match(src, /item\.credits === 1 \? 'credit' : 'credits'/);
  assert.match(src, /sticky bottom-3[\s\S]*lg:static/);
});

test('the Explore hero image is eagerly responsive', () => {
  const src = read('app/veyrnox/app/page.js');
  assert.match(src, /oddling-body-chaos\.webp[\s\S]*loading="eager"[\s\S]*sizes="\(max-width: 1023px\) 100vw, 55vw"/);
});

test('Publish failures lead to recovery and calendar loading has a ceiling', () => {
  const analytics = read('app/veyrnox/app/publish/analytics/page.js');
  assert.match(analytics, /href="\/app\/publish"[\s\S]*Reconnect it in Veyrnox Publish/);
  const calendar = read('app/veyrnox/app/publish/calendar/page.js');
  assert.match(calendar, /window\.setTimeout\([\s\S]*calendar is taking too long to load[\s\S]*,8000\)/);
  assert.match(calendar, /return\(\)=>\{active=false;window\.clearTimeout\(timeout\);\}/);
});

test('Video Agent owns descriptive no-index metadata', () => {
  const src = read('app/veyrnox/app/video-agent/layout.js');
  assert.match(src, /title: 'Video Agent'/);
  assert.match(src, /canonical: '\/app\/video-agent'/);
  assert.match(src, /robots: \{ index: false, follow: false \}/);
});

test('floating utilities avoid bottom actions and remain compact', () => {
  const src = read('app/veyrnox/_components/SiteChrome.js');
  assert.match(src, /fixed right-2 top-\[9\.75rem\]/);
  assert.match(src, /aria-label="Contact support by email"/);
  assert.doesNotMatch(src, /usePathname|raised=\{|tucked=\{/);
});

test('sitemap entries do not pretend every page changed on every request', () => {
  const src = read('app/sitemap.js');
  assert.doesNotMatch(src, /lastModified: now|const now = new Date/);
});

test('Reticle layout state is observable as the UI moves', () => {
  const src = read('app/reticle-dev.jsx');
  assert.match(src, /registerStore\('veyLayout', readVeyLayout, subscribeVeyLayout\)/);
  assert.match(src, /new MutationObserver\(schedule\)/);
  assert.match(src, /storageNoticeOpen:/);
  assert.match(src, /siteActionsOverlap:/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { appMessagesFor } from '../lib/i18n/appMessages.mjs';

const page = await readFile(new URL('../app/veyrnox/app/page.js', import.meta.url), 'utf8');

test('Explore starts with the three core creation workspaces', () => {
  const launchpad = page.slice(page.indexOf('<section aria-label={t(\'app.explore.start\')}'), page.indexOf('<VibeOffer'));
  assert.match(launchpad, /<StarterCard href="\/app\/create"/);
  assert.match(launchpad, /<StarterCard href="\/app\/chat"/);
  assert.match(launchpad, /<StarterCard href="\/app\/film-studio"/);
  assert.equal((page.match(/data-testid=\{`explore-starter-/g) || []).length, 1,
    'the shared card template gives every starter a stable test id');
  assert.ok(page.indexOf('<StarterCard href="/app/create"') < page.indexOf('href="/app/oddlings"'),
    'creation choices come before the featured Oddlings promotion');
});

test('the launchpad is usable at narrow widths and names the template gallery', () => {
  assert.match(page, /className="my-8 grid gap-3 md:grid-cols-3"/,
    'cards stack by default and become columns only when space allows');
  assert.match(page, /aria-labelledby="explore-presets-title"/);
  assert.match(page, /id="explore-presets-title"/);
  assert.match(page, /active:scale-\[0\.96\]/,
    'interactive cards use the restrained shared press scale');
});

test('every app locale translates the new entry hierarchy', async () => {
  for (const locale of ['en', 'es', 'zh', 'hi', 'ar', 'fr', 'pt', 'ru', 'ja', 'de', 'ko']) {
    const messages = await appMessagesFor(locale);
    for (const key of ['app.explore.start', 'app.explore.startIntro', 'app.explore.createStart', 'app.explore.filmStart']) {
      assert.ok(messages[key]?.trim(), `${locale} provides ${key}`);
    }
  }
});

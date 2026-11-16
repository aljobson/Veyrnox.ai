// ADR-0344: Film Studio is hidden from the website. Code, data and the API stay.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FILM_STUDIO_ENABLED } from '../app/veyrnox/_lib/filmStudioSwitch.js';
import { STUDIO_DESTINATIONS } from '../app/veyrnox/_lib/studioNavigation.js';
import { PRIMARY_NAV_CATEGORIES, NAV_CATEGORIES } from '../app/veyrnox/_lib/tokens.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('the switch is off', () => assert.equal(FILM_STUDIO_ENABLED, false));

test('no menu, nav or header entry points at Film Studio', () => {
  assert.ok(!STUDIO_DESTINATIONS.some((d) => d.href === '/app/film-studio'));
  assert.ok(![...PRIMARY_NAV_CATEGORIES, ...NAV_CATEGORIES].some((c) => c.href === '/app/film-studio'));
});

test('the workspace page answers 404 behind the switch', () => {
  const page = read('app/veyrnox/app/film-studio/page.js');
  assert.match(page, /if \(!FILM_STUDIO_ENABLED\) notFound\(\)/);
});

test('every web entry is gated by the switch', () => {
  for (const [file, pattern] of [
    ['app/veyrnox/app/page.js', /FILM_STUDIO_ENABLED \|\| key !== 'film'/],
    ['app/veyrnox/_components/chat/SkillsPanel.js', /FILM_STUDIO_ENABLED && <Link href="\/app\/film-studio"/],
    ['app/veyrnox/_components/chat/WorkflowsPanel.js', /FILM_STUDIO_ENABLED \|\| workflow\.href !== '\/app\/film-studio'/],
    ['app/veyrnox/_components/UseTemplate.js', /FILM_STUDIO_ENABLED && !templateClip && isVideo/],
    ['app/veyrnox/app/dialogue/DialogueStudioClient.js', /FILM_STUDIO_ENABLED && <Link href=\{`\/app\/film-studio/],
  ]) assert.match(read(file), pattern, file);
});

test('the data and API stay: routes, masters and the editor library badge are untouched', () => {
  assert.match(read('app/api/v1/film-studio/route.js'), /export/);
  assert.match(read('app/veyrnox/_lib/editorLibraryTile.mjs'), /master: 'Film Studio'/);
});

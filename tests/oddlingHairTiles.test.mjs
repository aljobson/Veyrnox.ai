import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import * as React from 'react';
import { fixture } from './helpers/publicSiteRender.mjs';
import { appMessagesFor } from '../lib/i18n/appMessages.mjs';
import { CHARACTER_GROUPS } from '../app/veyrnox/_lib/character.js';
import { HAIR_TILE_STYLES, hairTileSlug, hairTileSrc } from '../app/veyrnox/_lib/oddlingHairTiles.js';
import { cellsOf, foregroundMask, valleys } from '../scripts/slice-hair-sheets.mjs';

const hairOptions = CHARACTER_GROUPS.find((group) => group.id === 'hair').options.map(([value]) => value);
const dir = new URL('../public/oddlings/hair/', import.meta.url);

test('every hairstyle with a picture is a real hair option, listed once', () => {
  assert.deepEqual(HAIR_TILE_STYLES.filter((style) => !hairOptions.includes(style)), []);
  assert.equal(new Set(HAIR_TILE_STYLES).size, HAIR_TILE_STYLES.length);
});

test('slugs are file-safe and different for every hair option', () => {
  assert.equal(hairTileSlug('Fur / Mane'), 'fur-mane');
  assert.equal(hairTileSlug('Pixie Cut'), 'pixie-cut');
  const slugs = hairOptions.map(hairTileSlug);
  assert.equal(new Set(slugs).size, slugs.length);
  for (const slug of slugs) assert.match(slug, /^[a-z0-9]+(-[a-z0-9]+)*$/);
});

test('the picture files are exactly the listed styles: none missing, none left over', () => {
  const files = readdirSync(dir).filter((name) => name.endsWith('.webp')).sort();
  assert.deepEqual(files, HAIR_TILE_STYLES.map((style) => `${hairTileSlug(style)}.webp`).sort());
});

test('each picture is a small WebP, not a stray full-size render', () => {
  for (const style of HAIR_TILE_STYLES) {
    const file = new URL(`${hairTileSlug(style)}.webp`, dir);
    const bytes = readFileSync(file);
    assert.equal(bytes.subarray(0, 4).toString('latin1'), 'RIFF', `${style}: not a WebP`);
    assert.equal(bytes.subarray(8, 12).toString('latin1'), 'WEBP', `${style}: not a WebP`);
    assert.ok(statSync(file).size < 30_000, `${style}: ${statSync(file).size} bytes is too large for a catalog tile`);
  }
});

test('a style with a picture gets its file and anything else gets none', () => {
  assert.equal(hairTileSrc('Crescent Cut'), '/oddlings/hair/crescent-cut.webp');
  assert.equal(hairTileSrc('Not A Real Style'), '');
  assert.equal(hairTileSrc('Afro'), '/oddlings/hair/afro.webp');
  assert.equal(hairTileSrc('Fur / Mane'), '/oddlings/hair/fur-mane.webp');
  assert.equal(hairTileSrc(undefined), '');
});

// ---- the slicer's geometry, on synthetic sheets ----
function sheet(width, height, blobs, background = 220) {
  const data = Buffer.alloc(width * height * 3, background);
  for (const [x0, y0, x1, y1, value = 40] of blobs) for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) data.fill(value, (y * width + x) * 3, (y * width + x) * 3 + 3);
  return { data, width, height };
}

test('the foreground mask keeps dark shapes and ignores a soft shadow', () => {
  const image = sheet(40, 40, [[10, 10, 20, 20, 40], [25, 25, 35, 35, 205]]);
  const { mask } = foregroundMask(image);
  assert.equal(mask[15 * 40 + 15], 1);
  assert.equal(mask[30 * 40 + 30], 0);
  assert.equal(mask[0], 0);
});

test('a valley is the gap between two heads, not the empty margin beside the first one', () => {
  const profile = Array.from({ length: 400 }, (_, x) => ((x >= 120 && x < 250) || (x >= 300 && x < 390) ? 100 : 0));
  const [cut] = valleys(profile, 2);
  assert.ok(cut >= 250 && cut <= 300, `cut at ${cut}`);
});

test('a 2 by 2 sheet is cut into four squares, each inside its own cell', () => {
  const image = sheet(400, 400, [[40, 30, 140, 170], [250, 40, 350, 160], [60, 230, 160, 370], [230, 220, 370, 380]]);
  const cells = cellsOf(image, [2, 2]);
  assert.equal(cells.length, 4);
  cells.forEach((cell, i) => {
    assert.ok(cell, `cell ${i} is empty`);
    assert.ok(cell.size >= 100, `cell ${i} is too small (${cell.size})`);
    const centreX = cell.x + cell.size / 2, centreY = cell.y + cell.size / 2;
    assert.ok(centreX >= cell.rect.x0 && centreX < cell.rect.x1 && centreY >= cell.rect.y0 && centreY < cell.rect.y1, `cell ${i} is centred outside its own cell`);
  });
  assert.ok(cells[0].rect.x1 <= cells[1].rect.x0 + 1 && cells[0].rect.y1 <= cells[2].rect.y0 + 1);
});

test('a sheet with a missing head reports an empty cell instead of shifting the labels', () => {
  const image = sheet(400, 400, [[40, 30, 140, 170], [250, 40, 350, 160], [60, 230, 160, 370]]);
  const cells = cellsOf(image, [2, 2]);
  assert.equal(cells.filter(Boolean).length, 3);
  assert.equal(cells[3], null);
});

// ---- the catalog tile grid, rendered from the shipped component ----
const f = fixture('en', '/app/oddlings', { messages: await appMessagesFor('en') });
const { TileGroup } = f.load('app/veyrnox/_components/OddlingCatalogControls.js');
const hairGroup = CHARACTER_GROUPS.find((group) => group.id === 'hair');
const renderHair = (value = '') => f.render(React.createElement(TileGroup, { group: hairGroup, picks: {}, value, onChange() {}, categoryId: 'hair' }));

test('the hair grid shows a picture for every style', () => {
  const html = renderHair('Afro');
  assert.equal((html.match(/<img /g) || []).length, HAIR_TILE_STYLES.length);
  for (const style of HAIR_TILE_STYLES) assert.ok(html.includes(`src="${hairTileSrc(style)}"`), `${style} has no picture in the grid`);
  // Every hairstyle now has a picture, so no hair button falls back to the drawn mannequin.
  const buttons = html.split('<button').slice(1);
  for (const style of ['Crescent Cut', 'Spines', 'Antennae']) {
    const button = buttons.find((markup) => markup.includes(`>${style}<`));
    assert.ok(button, `${style} tile missing`);
    assert.ok(button.includes('<img '), `${style} should show its picture`);
    assert.ok(!button.includes('<svg'), `${style} should not draw the figure`);
  }
});

test('a picture tile is decorative, lazy and keeps the pressed state', () => {
  const html = renderHair('Afro');
  assert.ok(html.includes('alt=""') && html.includes('loading="lazy"'));
  const afro = html.split('<button').slice(1).find((markup) => markup.includes('>Afro<'));
  assert.ok(afro.includes('aria-pressed="true"'));
});

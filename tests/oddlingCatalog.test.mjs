import test from 'node:test';
import assert from 'node:assert/strict';
import { CHARACTER_GROUPS } from '../app/veyrnox/_lib/character.js';
import {
  CATALOG_CATEGORIES, CATEGORY_FOCUS, CATEGORY_ICONS, TILE_FOCUS, SWATCHES, SLIDER_SCALES, controlKind, tileKind, tileFocus, categoryById, categoryGroups, categoryProgress, sliderPosition, sliderValue, catalogGroup,
} from '../app/veyrnox/_lib/oddlingCatalog.js';

const optionsOf = (id) => CHARACTER_GROUPS.find((group) => group.id === id).options.map(([value]) => value);

test('every character group is in exactly one catalog category, so nothing the chips offered is lost', () => {
  const seen = new Map();
  for (const category of CATALOG_CATEGORIES) {
    for (const id of category.groupIds) {
      assert.ok(catalogGroup(id), `${category.id} lists "${id}", which is not a character group`);
      assert.ok(!seen.has(id), `"${id}" is in both ${seen.get(id)} and ${category.id}`);
      seen.set(id, category.id);
    }
  }
  const missing = CHARACTER_GROUPS.map((group) => group.id).filter((id) => !seen.has(id));
  assert.deepEqual(missing, [], `groups with no category: ${missing.join(', ')}`);
});

test('categories have unique ids, plain labels and a hint, and the first is the fallback for an unknown id', () => {
  const ids = CATALOG_CATEGORIES.map((category) => category.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const category of CATALOG_CATEGORIES) { assert.ok(category.label.length > 1 && category.hint.length > 5); assert.ok(categoryGroups(category).length > 0); }
  assert.equal(categoryById('nope').id, CATALOG_CATEGORIES[0].id);
  assert.equal(categoryById('hair').label, 'Hair');
});

test('colour groups have a swatch and a flat fill for every option, and no swatch for an option that does not exist', () => {
  for (const [group, table] of Object.entries(SWATCHES)) {
    const options = optionsOf(group);
    assert.deepEqual(Object.keys(table).sort(), [...options].sort(), `${group}: swatches and options differ`);
    for (const [name, colour] of Object.entries(table)) {
      assert.match(colour.swatch, /^(#[0-9a-f]{6}|(repeating-)?linear-gradient\(.+\))$/i, `${group}/${name} swatch`);
      assert.match(colour.fill, /^#[0-9a-f]{6}$/i, `${group}/${name} fill`);
    }
  }
});

test('slider scales use exactly the group\'s own options, ordered smallest first', () => {
  for (const [group, scale] of Object.entries(SLIDER_SCALES)) {
    assert.deepEqual([...scale].sort(), optionsOf(group).sort(), `${group}: scale does not match the group's options`);
  }
  assert.deepEqual(SLIDER_SCALES.height, ['Very Short', 'Short', 'Average', 'Tall', 'Very Tall']);
  assert.deepEqual(SLIDER_SCALES.age, ['20s', '30s', '40s', '50s', '60s', '70+']);
  for (const group of ['head_size', 'eye_size', 'foot_size']) assert.deepEqual(SLIDER_SCALES[group], ['Small', 'Medium', 'Large', 'Extra Large']);
});

test('each group gets the right kind of control, and drawn groups are exactly those with a crop', () => {
  for (const id of ['skin_tone', 'hair_color', 'eye_color']) assert.equal(controlKind(id), 'swatch');
  for (const id of Object.keys(SLIDER_SCALES)) assert.equal(controlKind(id), 'slider');
  for (const id of ['hair', 'wardrobe_style', 'body_type', 'headwear', 'brows', 'accessories']) assert.equal(controlKind(id), 'tiles');
  const drawn = CHARACTER_GROUPS.map((g) => g.id).filter((id) => tileKind(id) === 'mannequin').sort();
  assert.deepEqual(drawn, Object.keys(TILE_FOCUS).sort(), 'a group is drawn exactly when it has a crop');
  for (const id of ['hair', 'headwear', 'wardrobe_style', 'body_type', 'head_shape', 'brows', 'nose_shape', 'mouth', 'facial_hair', 'eye_shape']) assert.equal(tileKind(id), 'mannequin', id);
  assert.equal(tileFocus('nose_shape'), 'face'); assert.equal(tileFocus('hair'), 'head'); assert.equal(tileFocus('body_type'), 'body'); assert.equal(tileFocus('unknown'), 'body');
  assert.ok(Object.values(TILE_FOCUS).every((focus) => ['face', 'head', 'neck', 'armLeft', 'armRight', 'legLeft', 'legRight', 'body'].includes(focus)));
  assert.deepEqual(Object.keys(CATEGORY_FOCUS).sort(), CATALOG_CATEGORIES.map((c) => c.id).sort());
  assert.equal(tileKind('accessories'), 'icon', 'a group with no drawing yet falls back to icon tiles');
});

test('a slider position 0 is Any, positions map to the scale in order, and bad input clamps', () => {
  assert.equal(sliderPosition('height', {}), 0);
  assert.equal(sliderPosition('height', { height: 'Average' }), 3);
  assert.equal(sliderPosition('height', { height: 'Not a height' }), 0, 'an unknown stored value reads as Any');
  assert.equal(sliderPosition('hair', { hair: 'Afro' }), 0, 'a group with no scale has no position');
  assert.equal(sliderValue('height', 0), '');
  assert.equal(sliderValue('height', 1), 'Very Short');
  assert.equal(sliderValue('height', 5), 'Very Tall');
  assert.equal(sliderValue('height', 99), 'Very Tall');
  assert.equal(sliderValue('height', -3), '');
  assert.equal(sliderValue('height', '2'), 'Short');
  assert.equal(sliderValue('height', 'x'), '');
  assert.equal(sliderValue('hair', 2), '');
  for (const group of Object.keys(SLIDER_SCALES)) for (const value of SLIDER_SCALES[group]) assert.equal(sliderValue(group, sliderPosition(group, { [group]: value })), value);
});

test('category progress counts the groups that have a pick', () => {
  const eyes = categoryById('eyes');
  assert.deepEqual(categoryProgress(eyes, {}), { picked: 0, total: 5 });
  assert.deepEqual(categoryProgress(eyes, { eye_color: 'Blue', eye_size: 'Large', hair: 'Afro' }), { picked: 2, total: 5 });
  assert.deepEqual(categoryProgress(eyes, undefined), { picked: 0, total: 5 });
});

test('every category has a rail icon path', () => {
  assert.deepEqual(Object.keys(CATEGORY_ICONS).sort(), CATALOG_CATEGORIES.map((category) => category.id).sort());
  for (const path of Object.values(CATEGORY_ICONS)) {
    assert.match(path, /^M[-\d.,\sA-Za-z]+$/);
    assert.ok(!/NaN|undefined/.test(path));
  }
});

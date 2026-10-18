import test from 'node:test';
import assert from 'node:assert/strict';
import { CHARACTER_GROUPS } from '../app/veyrnox/_lib/character.js';
import { SWATCHES } from '../app/veyrnox/_lib/oddlingCatalog.js';
import { mannequinShapes, mannequinParams, mannequinViewBox, HAIR_SHAPES, BUILDS, OUTFITS, MANNEQUIN_BOX } from '../app/veyrnox/_lib/oddlingMannequin.js';

const optionsOf = (id) => CHARACTER_GROUPS.find((group) => group.id === id).options.map(([value]) => value);
const shapeOf = (shapes, key) => shapes.find((shape) => shape.key === key);

function assertSound(shapes, label) {
  const keys = new Set();
  for (const shape of shapes) {
    assert.ok(!keys.has(shape.key), `${label}: duplicate key ${shape.key}`); keys.add(shape.key);
    for (const [name, value] of Object.entries(shape.attrs)) if (typeof value === 'number') assert.ok(Number.isFinite(value), `${label}: ${shape.key}.${name} is ${value}`);
    if (shape.attrs.d) assert.ok(!/NaN|undefined|Infinity/.test(shape.attrs.d), `${label}: ${shape.key} path is broken`);
    if (shape.tag === 'circle') assert.ok(shape.attrs.cx - shape.attrs.r >= -1 && shape.attrs.cx + shape.attrs.r <= MANNEQUIN_BOX.width + 1 && shape.attrs.cy - shape.attrs.r >= -1, `${label}: ${shape.key} leaves the picture`);
  }
}

test('every option of every drawn group has a drawing, so no pick is silently drawn wrong', () => {
  assert.deepEqual(optionsOf('hair').filter((value) => !HAIR_SHAPES[value]), []);
  assert.deepEqual(optionsOf('body_type').filter((value) => !BUILDS[value]), []);
  assert.deepEqual(optionsOf('wardrobe_style').filter((value) => !OUTFITS[value]), []);
  for (const value of optionsOf('hair')) assertSound(mannequinShapes({ hair: value }), `hair ${value}`);
  for (const value of optionsOf('body_type')) assertSound(mannequinShapes({ body_type: value }), `body ${value}`);
  for (const value of optionsOf('wardrobe_style')) assertSound(mannequinShapes({ wardrobe_style: value }), `outfit ${value}`);
  for (const value of optionsOf('headwear')) assertSound(mannequinShapes({ headwear: value }), `headwear ${value}`);
});

test('different hair shapes draw differently, a bald head has no hair, and the colour follows the pick', () => {
  const hairKeys = (picks) => mannequinShapes(picks).filter((shape) => shape.key.startsWith('hair-')).map((shape) => shape.key).join();
  assert.equal(hairKeys({ hair: 'Bald' }), '');
  const shapes = [...new Set(Object.values(HAIR_SHAPES))].filter((name) => name !== 'none');
  const byShape = new Map(shapes.map((name) => [name, Object.keys(HAIR_SHAPES).find((option) => HAIR_SHAPES[option] === name)]));
  const drawings = [...byShape].map(([name, option]) => [name, JSON.stringify(mannequinShapes({ hair: option }).filter((s) => s.key.startsWith('hair-')).map((s) => s.attrs))]);
  for (const [name, drawing] of drawings) assert.notEqual(drawing, '[]', `${name} draws nothing`);
  assert.equal(new Set(drawings.map(([, drawing]) => drawing)).size, drawings.length, 'two hair shapes draw the same');
  const blue = shapeOf(mannequinShapes({ hair: 'Short Hair', hair_color: 'Electric Blue' }), 'hair-h');
  assert.equal(blue.fill, SWATCHES.hair_color['Electric Blue'].fill);
});

test('skin and eye colours follow the picks, and unpicked parts use neutral defaults, never undefined', () => {
  assert.equal(shapeOf(mannequinShapes({ skin_tone: 'Deep' }), 'head').fill, SWATCHES.skin_tone.Deep.fill);
  assert.equal(shapeOf(mannequinShapes({ eye_color: 'Green' }), 'eye-l').fill, SWATCHES.eye_color.Green.fill);
  const plain = mannequinParams({});
  assert.equal(plain.skin, SWATCHES.skin_tone.Light.fill); assert.equal(plain.hairShape, 'short'); assert.equal(plain.fit, 1);
  assert.doesNotThrow(() => mannequinShapes(undefined)); assert.doesNotThrow(() => mannequinShapes(null));
  assert.doesNotThrow(() => mannequinShapes({ hair: 'Made up', body_type: 'Made up', wardrobe_style: 'Made up', skin_tone: 'Made up', height: 'Made up', head_size: '??' }), 'unknown stored values fall back');
});

test('height, head size and body width change the drawing in the expected direction', () => {
  const headY = (picks) => mannequinParams(picks).headCy;
  assert.ok(headY({ height: 'Very Tall' }) < headY({ height: 'Average' }) && headY({ height: 'Average' }) < headY({ height: 'Very Short' }));
  assert.ok(mannequinParams({ head_size: 'Extra Large' }).headR > mannequinParams({ head_size: 'Small' }).headR);
  const headScale = (picks) => Number(shapeOf(mannequinShapes(picks), 'head').attrs.transform.match(/scale\(([\d.]+)\)/)[1]);
  assert.ok(headScale({ head_size: 'Extra Large' }) > headScale({ head_size: 'Small' }), 'the drawn head follows the head size');
  const torsoWidth = (body) => { const d = shapeOf(mannequinShapes({ body_type: body }), 'torso').attrs.d; const xs = [...d.matchAll(/[ML]\s?(-?[\d.]+)/g)].map((m) => Number(m[1])); return Math.max(...xs) - Math.min(...xs); };
  assert.ok(torsoWidth('Fat') > torsoWidth('Athletic') && torsoWidth('Athletic') > torsoWidth('Very Skinny'));
  assert.ok(mannequinParams({ leg_size: 'Extra Large' }).legPx > mannequinParams({ leg_size: 'Small' }).legPx);
});

test('stacking every tall choice shrinks the whole figure to fit instead of running off the picture', () => {
  const extreme = { height: 'Very Tall', leg_size: 'Extra Large', torso_size: 'Extra Large', head_size: 'Extra Large', body_type: 'Long Legs', hair: 'Tube Tower', neck_size: 'Extra Large' };
  const params = mannequinParams(extreme);
  assert.ok(params.fit < 1 && params.fit > 0.5);
  const shapes = mannequinShapes(extreme);
  assertSound(shapes, 'extreme');
  const top = Math.min(...shapes.filter((s) => s.tag === 'circle' || s.tag === 'rect').map((s) => (s.tag === 'circle' ? s.attrs.cy - s.attrs.r : s.attrs.y)));
  assert.ok(top >= -1, `the figure starts at y=${top}`);
});

test('glasses and headwear are drawn only when picked, and a tile can focus on the head', () => {
  const none = mannequinShapes({});
  assert.ok(!none.some((s) => s.key.startsWith('glass-') || s.key.startsWith('wear-')));
  assert.equal(mannequinShapes({ everyday_accessories: 'Sunglasses' }).filter((s) => /^glass--?1$/.test(s.key)).length, 2, 'two lenses');
  assert.equal(mannequinShapes({ everyday_accessories: 'Jewellery' }).filter((s) => s.key.startsWith('glass-')).length, 0, 'accessories the figure cannot show are not faked');
  assert.ok(mannequinShapes({ headwear: 'Beanie' }).some((s) => s.key.startsWith('wear-')));
  assert.equal(mannequinViewBox('body', {}), '0 0 120 230');
  const [x, y, w, h] = mannequinViewBox('head', {}).split(' ').map(Number);
  assert.ok(w < 120 && h < 120 && y > 0 && x > 0);
  const [fx, fy, fw, fh] = mannequinViewBox('face', {}).split(' ').map(Number);
  assert.ok(fw < w && fh < h && fx > 0 && fy > 0, 'a face tile is a tighter crop than a head tile');
});

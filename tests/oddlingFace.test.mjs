import test from 'node:test';
import assert from 'node:assert/strict';
import { CHARACTER_GROUPS } from '../app/veyrnox/_lib/character.js';
import { FACE_TABLES, faceShapes, headOutline, darken, lighten } from '../app/veyrnox/_lib/oddlingFace.js';
import { mannequinShapes } from '../app/veyrnox/_lib/oddlingMannequin.js';

const optionsOf = (id) => CHARACTER_GROUPS.find((group) => group.id === id).options.map(([value]) => value);
const palette = { skin: '#dcb08a', hairFill: '#5a3a22', eyeFill: '#3f7fd0', eyeScale: 1, mouthScale: 1 };
const drawing = (picks) => JSON.stringify(faceShapes(picks, palette));

// Groups the face draws by name, and the options each one lists. Groups whose picks change how the face looks but have no table of their own are checked by distinctness below.
const FACE_GROUPS = ['head_shape', 'chin_jaw', 'eye_shape', 'eyes_type', 'eyes_details', 'brows', 'nose_shape', 'cheeks', 'lips', 'mouth', 'ears', 'horns', 'face_features', 'facial_hair'];

test('every option of every face group has an entry in the face tables', () => {
  for (const group of Object.keys(FACE_TABLES)) {
    const options = optionsOf(group);
    assert.deepEqual(FACE_TABLES[group].filter((name) => !options.includes(name)), [], `${group}: the face draws an option that does not exist`);
    assert.deepEqual(options.filter((name) => !FACE_TABLES[group].includes(name)), [], `${group}: options with no drawing`);
  }
});

test('within a face group, every option draws differently from its siblings and from the unpicked face, so no two tiles look the same', () => {
  const plain = drawing({});
  for (const group of FACE_GROUPS) {
    const seen = new Map();
    for (const option of optionsOf(group)) {
      const shape = drawing({ [group]: option });
      assert.ok(!seen.has(shape), `${group}: "${option}" looks the same as "${seen.get(shape)}"`);
      seen.set(shape, option);
    }
    // Options that mean "the ordinary one" may match the unpicked face; everything else must visibly change it.
    const same = optionsOf(group).filter((option) => drawing({ [group]: option }) === plain);
    assert.ok(same.length <= 2, `${group}: ${same.join(', ')} change nothing on the face`);
  }
});

test('every face drawing is made of finite numbers and valid paths, for every option', () => {
  for (const group of FACE_GROUPS) for (const option of optionsOf(group)) {
    const { shapes, scale } = faceShapes({ [group]: option }, palette);
    assert.ok(Number.isFinite(scale) && scale > 0.5 && scale < 1.5);
    const keys = new Set();
    for (const shape of shapes) {
      assert.ok(!keys.has(shape.key), `${group}/${option}: duplicate key ${shape.key}`); keys.add(shape.key);
      for (const [name, value] of Object.entries(shape.attrs)) {
        if (typeof value === 'number') assert.ok(Number.isFinite(value), `${group}/${option}: ${shape.key}.${name}`);
        else assert.ok(!/NaN|undefined|Infinity/.test(value), `${group}/${option}: ${shape.key}.${name} = ${value}`);
      }
    }
  }
});

test('the picked colours reach the face: skin on the head, eye colour on the iris, hair colour on brows and beard', () => {
  const find = (picks, key, colours = {}) => faceShapes(picks, { ...palette, ...colours }).shapes.find((shape) => shape.key === key);
  assert.equal(find({}, 'head', { skin: '#123456' }).fill, '#123456');
  assert.equal(find({}, 'eye-l', { eyeFill: '#00aa00' }).fill, '#00aa00');
  assert.equal(find({ brows: 'Thick' }, 'brow--1', { hairFill: '#ff0000' }).stroke, darken('#ff0000', 0.1));
  assert.equal(find({ facial_hair: 'Full Beard' }, 'facial-hair', { hairFill: '#ff0000' }).fill, darken('#ff0000', 0.05));
  assert.notEqual(find({ brows: 'Bleached' }, 'brow--1').stroke, find({ brows: 'Thick' }, 'brow--1').stroke, 'bleached brows are pale');
});

test('special eyes behave: heterochromia differs left to right, a blind eye has no pupil, reptile eyes have a slit, mechanical eyes a ring', () => {
  const eye = (picks, key) => faceShapes(picks, palette).shapes.find((shape) => shape.key === key);
  assert.notEqual(eye({ eyes_details: 'Heterochromia' }, 'eye-l').fill, eye({ eyes_details: 'Heterochromia' }, 'eye-r').fill);
  assert.equal(eye({ eyes_details: 'Blind Eye' }, 'eye-pupil-r'), undefined);
  assert.ok(eye({ eyes_details: 'Blind Eye' }, 'eye-pupil-l'));
  assert.ok(eye({ eyes_type: 'Reptile' }, 'eye-pupil-l').attrs.ry > eye({ eyes_type: 'Reptile' }, 'eye-pupil-l').attrs.rx * 3, 'a vertical slit');
  assert.ok(eye({ eyes_type: 'Mechanical' }, 'eye-l').stroke);
  assert.ok(eye({ eyes_details: 'Glowing Eye' }, 'eye-glow-r'));
});

test('an eye shape that was chosen changes eye spacing or size in the direction its name says', () => {
  const gap = (picks) => faceShapes(picks, palette).shapes.find((shape) => shape.key === 'eye-white-r').attrs.transform.match(/translate\(([-\d.]+)/)[1] * 1;
  assert.ok(gap({ eye_shape: 'Wide Set' }) > gap({}) && gap({}) > gap({ eye_shape: 'Close Set' }));
  const height = (picks) => faceShapes(picks, palette).shapes.find((shape) => shape.key === 'eye-white-l').attrs.ry;
  assert.ok(height({ eye_shape: 'Round' }) > height({ eye_shape: 'Narrow' }));
  const sizeOf = (picks) => faceShapes(picks, { ...palette, eyeScale: picks.big ? 1.6 : 0.75 }).shapes.find((shape) => shape.key === 'eye-white-l').attrs.rx;
  assert.ok(sizeOf({ big: true }) > sizeOf({}));
});

test('head and jaw picks change the outline in the direction their names say', () => {
  const widthAt = (outline) => { const xs = [...outline.d.matchAll(/(-?\d+\.?\d*) (-?\d+\.?\d*)/g)].map((m) => [Number(m[1]), Number(m[2])]); return (y) => Math.max(...xs.filter(([, py]) => Math.abs(py - y) < 0.2).map(([x]) => Math.abs(x))); };
  assert.ok(widthAt(headOutline('Long Oval'))(0.1) < widthAt(headOutline('Perfect Round'))(0.1));
  assert.ok(headOutline('Tiny Head').scale < 1 && headOutline('Oversized Head').scale > 1 && headOutline('Perfect Round').scale === 1);
  assert.ok(headOutline('Heart').d !== headOutline('Diamond').d);
  assert.ok(headOutline('Perfect Round', 'Prominent Chin').chinY > headOutline('Perfect Round', 'Round Chin').chinY, 'a prominent chin sits lower');
  assert.ok(headOutline('Perfect Round', 'Pointed Chin').jawWidth < headOutline('Perfect Round', 'Strong Jaw').jawWidth);
  assert.equal(headOutline('Perfect Round', 'Cleft Chin').cleft, true);
  assert.equal(headOutline('Perfect Round', 'Soft Jaw').cleft, false);
  assert.ok(!/NaN/.test(headOutline('Not a head', 'Not a jaw').d), 'unknown picks fall back to a normal head');
});

test('on the figure, the face sits in a transform tied to the head and a stored unknown value never breaks it', () => {
  const shapes = mannequinShapes({ head_shape: 'Square', brows: 'Thick', nose_shape: 'Aquiline', mouth: 'Bright Smile', facial_hair: 'Goatee', ears: 'Elf Ears', horns: 'Big Horns', eyes_details: 'Glowing Eye' });
  const head = shapes.find((shape) => shape.key === 'head');
  assert.match(head.attrs.transform, /^translate\([\d.]+ [\d.]+\) scale\([\d.]+\)$/);
  for (const key of ['brow--1', 'nose-bridge', 'mouth-open', 'facial-hair', 'ear--1', 'horn-1', 'eye-glow-r']) assert.ok(shapes.some((shape) => shape.key === key), key);
  assert.doesNotThrow(() => mannequinShapes({ head_shape: 'x', chin_jaw: 'x', eye_shape: 'x', brows: 'x', nose_shape: 'x', mouth: 'x', lips: 'x', ears: 'x', horns: 'x', facial_hair: 'x', cheeks: 'x', face_features: 'x' }));
  assert.ok(lighten('#000000', 0.5) === '#808080');
});

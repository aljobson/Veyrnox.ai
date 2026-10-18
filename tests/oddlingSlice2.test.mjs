import test from 'node:test';
import assert from 'node:assert/strict';
import { CHARACTER_GROUPS } from '../app/veyrnox/_lib/character.js';
import { faceShapes } from '../app/veyrnox/_lib/oddlingFace.js';
import { SKIN_TABLES } from '../app/veyrnox/_lib/oddlingSkinFx.js';
import { SPECIES_TABLE } from '../app/veyrnox/_lib/oddlingSpecies.js';
import { BODY_TABLES } from '../app/veyrnox/_lib/oddlingBodyParts.js';
import { mannequinShapes, mannequinParams, mannequinViewBox } from '../app/veyrnox/_lib/oddlingMannequin.js';
import { tileKind, tileFocus } from '../app/veyrnox/_lib/oddlingCatalog.js';

const optionsOf = (id) => CHARACTER_GROUPS.find((group) => group.id === id).options.map(([value]) => value);
const palette = { skin: '#dcb08a', hairFill: '#5a3a22', eyeFill: '#3f7fd0', eyeScale: 1, mouthScale: 1 };
const face = (picks) => JSON.stringify(faceShapes(picks, palette));
const body = (picks) => JSON.stringify(mannequinShapes(picks));

const BODY_GROUPS = ['proportions', 'neck', 'left_arm', 'right_arm', 'left_leg', 'right_leg', 'exaggeration'];
const SLICE2 = ['skin_conditions', 'face_skin_material', 'face_surface_pattern', 'character_type', 'exaggeration', 'proportions', 'neck', 'left_arm', 'right_arm', 'left_leg', 'right_leg'];

test('every option of every slice-2 group has a drawing, and nothing is drawn that is not an option', () => {
  const tables = { skin_conditions: SKIN_TABLES.skin_conditions, face_skin_material: SKIN_TABLES.face_skin_material, face_surface_pattern: SKIN_TABLES.face_surface_pattern,
    character_type: SPECIES_TABLE, proportions: BODY_TABLES.proportions, neck: BODY_TABLES.neck, left_arm: BODY_TABLES.arm, right_arm: BODY_TABLES.arm, left_leg: BODY_TABLES.leg, right_leg: BODY_TABLES.leg };
  for (const [group, drawn] of Object.entries(tables)) {
    const options = optionsOf(group);
    assert.deepEqual(drawn.filter((name) => !options.includes(name)), [], `${group}: draws an option that does not exist`);
    assert.deepEqual(options.filter((name) => !drawn.includes(name)), [], `${group}: options with no drawing`);
  }
  assert.deepEqual(optionsOf('exaggeration'), ['Natural', 'Bold', 'Extreme']);
});

test('every slice-2 group is a drawn tile with a sensible crop', () => {
  for (const id of SLICE2) assert.equal(tileKind(id), 'mannequin', `${id} still shows icon tiles`);
  assert.equal(tileFocus('neck'), 'neck'); assert.equal(tileFocus('left_leg'), 'legLeft'); assert.equal(tileFocus('right_arm'), 'armRight'); assert.equal(tileFocus('skin_conditions'), 'face');
});

test('within a slice-2 group every option draws differently, so no two tiles look the same', () => {
  const draw = (group) => (BODY_GROUPS.includes(group) ? body : face);
  for (const group of SLICE2) {
    const seen = new Map();
    for (const option of optionsOf(group)) {
      const shape = draw(group)({ [group]: option });
      assert.ok(!seen.has(shape), `${group}: "${option}" looks the same as "${seen.get(shape)}"`);
      seen.set(shape, option);
    }
  }
});

test('the ordinary option matches the unpicked figure and every other option changes it', () => {
  const ordinary = { skin_conditions: null, face_skin_material: 'Human Skin', face_surface_pattern: 'Solid', character_type: 'Human', exaggeration: 'Natural', proportions: 'Natural', neck: 'Bare', left_arm: 'Normal', right_arm: 'Normal', left_leg: 'Normal', right_leg: 'Normal' };
  for (const group of SLICE2) {
    const draw = (BODY_GROUPS.includes(group) ? body : face);
    for (const option of optionsOf(group)) {
      const same = draw({ [group]: option }) === draw({});
      assert.equal(same, option === ordinary[group], `${group}/${option}: ${same ? 'changes nothing' : 'changes the figure but is the ordinary option'}`);
    }
  }
});

test('every slice-2 drawing is finite numbers, valid paths and unique keys', () => {
  for (const group of SLICE2) for (const option of optionsOf(group)) {
    const picks = { [group]: option }, keys = new Set();
    const shapes = mannequinShapes(picks);
    for (const shape of shapes) {
      assert.ok(!keys.has(shape.key), `${group}/${option}: duplicate key ${shape.key}`); keys.add(shape.key);
      for (const [name, value] of Object.entries(shape.attrs)) {
        if (typeof value === 'number') assert.ok(Number.isFinite(value), `${group}/${option}: ${shape.key}.${name}`);
        else assert.ok(!/NaN|undefined|Infinity/.test(String(value)), `${group}/${option}: ${shape.key}.${name} = ${value}`);
      }
      assert.ok(shape.fill === undefined || !/NaN|undefined/.test(shape.fill), `${group}/${option}: ${shape.key} fill`);
    }
    for (const focus of ['face', 'head', 'upper', 'lower', 'neck', 'armLeft', 'armRight', 'legLeft', 'legRight', 'body']) assert.ok(!/NaN|undefined/.test(mannequinViewBox(focus, picks)), `${group}/${option}: view box ${focus}`);
  }
});

test('limbs: a missing arm has no hand, a missing leg has no shoe, each side is independent, and "left" is the character\'s left (the viewer\'s right)', () => {
  const keys = (picks) => mannequinShapes(picks).map((shape) => shape.key);
  const at = (picks, key) => mannequinShapes(picks).find((shape) => shape.key === key);
  assert.ok(!keys({ left_arm: 'None' }).includes('hand-r') && keys({ left_arm: 'None' }).includes('hand-l'));
  assert.ok(!keys({ right_leg: 'None' }).includes('shoe-l') && keys({ right_leg: 'None' }).includes('shoe-r'));
  assert.ok(at({ left_arm: 'Robotic' }, 'arm-r').attrs.d.startsWith('M7'), 'the left arm is drawn on the viewer\'s right (x > centre)');
  assert.ok(at({ right_arm: 'Robotic' }, 'arm-l').attrs.d.startsWith('M4'), 'the right arm is drawn on the viewer\'s left');
  assert.notEqual(body({ left_arm: 'Robotic' }), body({ right_arm: 'Robotic' }));
});

test('proportions move the numbers they name, and the figure still fits its box', () => {
  const base = mannequinParams({});
  assert.ok(mannequinParams({ proportions: 'Tiny Torso' }).torsoPx < base.torsoPx);
  assert.ok(mannequinParams({ proportions: 'Long Torso' }).torsoPx > base.torsoPx);
  assert.ok(mannequinParams({ proportions: 'Huge Hands' }).handR > base.handR && mannequinParams({ proportions: 'Tiny Hands' }).handR < base.handR);
  assert.ok(mannequinParams({ proportions: 'Long Neck' }).neckPx > base.neckPx && mannequinParams({ proportions: 'No Visible Neck' }).neckPx < 1);
  assert.ok(mannequinParams({ proportions: 'Wide Shoulders' }).shoulderAdd > 0 && mannequinParams({ proportions: 'Narrow Shoulders' }).shoulderAdd < 0);
  for (const option of optionsOf('proportions')) {
    const p = mannequinParams({ proportions: option, height: 'Very Tall', body_type: 'Fat', hair: 'Spiral Tower' });
    assert.ok(p.headCy - p.headR * 3 > -2, `${option}: head leaves the box`);
  }
});

test('exaggeration changes the silhouette, hair volume and accessory scale, and never the face or skin tone (the policy the prompt text states)', () => {
  const natural = mannequinParams({}), bold = mannequinParams({ exaggeration: 'Bold' }), extreme = mannequinParams({ exaggeration: 'Extreme' });
  assert.ok(bold.shoulderAdd > natural.shoulderAdd && extreme.shoulderAdd > bold.shoulderAdd, 'shoulders');
  assert.ok(bold.handR > natural.handR && extreme.handR > bold.handR, 'hands');
  assert.ok(extreme.volume > bold.volume && bold.volume > 1, 'hair volume');
  for (const option of optionsOf('exaggeration')) assert.equal(face({ exaggeration: option }), face({}), `${option}: the face must not change`);
  const skin = (picks) => mannequinShapes(picks).find((shape) => shape.key === 'head').fill;
  for (const option of optionsOf('exaggeration')) assert.equal(skin({ exaggeration: option }), skin({}));
  const hair = (picks) => mannequinShapes({ ...picks, hair: 'Afro' }).find((shape) => shape.key.startsWith('hair-'));
  assert.ok(!hair({}).attrs.transform && /scale/.test(hair({ exaggeration: 'Bold' }).attrs.transform), 'hair grows about the head only when exaggerated');
});

test('a creature type changes skin colour only when it is not a human-like type, and a person-picked skin tone is kept for human-like ones', () => {
  const head = (picks, skinColour = palette.skin) => faceShapes(picks, { ...palette, skin: skinColour }).shapes.find((shape) => shape.key === 'head').fill;
  assert.equal(head({ character_type: 'Human' }, '#4a2f22'), '#4a2f22');
  assert.equal(head({ character_type: 'Elf' }, '#4a2f22'), '#4a2f22');
  assert.notEqual(head({ character_type: 'Amphibian' }, '#4a2f22'), '#4a2f22');
});

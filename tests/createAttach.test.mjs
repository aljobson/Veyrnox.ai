import test from 'node:test';
import assert from 'node:assert/strict';
import { attachSlotFor, planAttachments } from '../lib/createAttach.mjs';

const text = { id: 't', kind: 'video', credits: 10, media: {} };
const i2v = { id: 'i2v', kind: 'video', credits: 20, media: { image: { required: true } } };
const i2vGated = { id: 'g', kind: 'video', credits: 5, gated: true, media: { image: { required: true } } };
const frames = { id: 'frames', kind: 'video', credits: 30, media: { image: { required: true }, endImage: { required: false } } };
const lipsync = { id: 'lip', kind: 'video', credits: 40, media: { image: { required: true }, audio: { required: true } } };
const edit = { id: 'edit', kind: 'image', credits: 3, media: { image: { required: false } } };
const file = (name, type) => ({ name, type });
const png = n => file(`${n}.png`, 'image/png');
const mp3 = file('a.mp3', 'audio/mpeg');

test('slot follows the file type', () => {
  assert.equal(attachSlotFor(file('a', 'image/png')), 'image');
  assert.equal(attachSlotFor(file('a', 'video/mp4')), 'video');
  assert.equal(attachSlotFor(file('a', 'audio/wav')), 'audio');
  assert.equal(attachSlotFor(file('a', 'application/pdf')), null);
});

test('one picture keeps the current model when it takes it', () => {
  const plan = planAttachments([text, i2v, frames], i2v, [png(1)]);
  assert.equal(plan.model, i2v);
  assert.deepEqual(plan.assignments.map(a => a.slot), ['image']);
});

test('one picture moves to the same kind, open, cheapest model', () => {
  assert.equal(planAttachments([text, edit, i2vGated, i2v, frames], text, [png(1)]).model, i2v);
});

test('two pictures go to a model with a start and an end frame', () => {
  const plan = planAttachments([text, i2v, frames], text, [png(1), png(2)]);
  assert.equal(plan.model, frames);
  assert.deepEqual(plan.assignments.map(a => [a.slot, a.file.name]), [['image', '1.png'], ['endImage', '2.png']]);
  assert.equal(plan.unused.length, 0);
});

test('a picture and a sound go to a model that takes both', () => {
  const plan = planAttachments([text, i2v, lipsync], text, [png(1), mp3]);
  assert.equal(plan.model, lipsync);
  assert.deepEqual(plan.assignments.map(a => a.slot), ['image', 'audio']);
});

test('files no slot takes are reported', () => {
  const plan = planAttachments([i2v], i2v, [png(1), png(2), file('x.pdf', 'application/pdf')]);
  assert.deepEqual(plan.unused.map(f => f.name), ['2.png', 'x.pdf']);
});

test('a model whose required slot the files cannot fill is skipped; none fit gives null', () => {
  assert.equal(planAttachments([lipsync], lipsync, [png(1)]), null);
  assert.equal(planAttachments([text], text, [mp3]), null);
});

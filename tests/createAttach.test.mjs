import test from 'node:test';
import assert from 'node:assert/strict';
import { attachSlotFor, modelForAttachment } from '../lib/createAttach.mjs';

const text = { id: 't', kind: 'video', credits: 10, media: {} };
const i2v = { id: 'i2v', kind: 'video', credits: 20, media: { image: { required: true } } };
const i2vGated = { id: 'g', kind: 'video', credits: 5, gated: true, media: { image: { required: true } } };
const edit = { id: 'edit', kind: 'image', credits: 3, media: { image: { required: false } } };
const needsBoth = { id: 'both', kind: 'video', credits: 1, media: { image: { required: true }, audio: { required: true } } };

test('slot follows the file type', () => {
  assert.equal(attachSlotFor({ type: 'image/png' }), 'image');
  assert.equal(attachSlotFor({ type: 'video/mp4' }), 'video');
  assert.equal(attachSlotFor({ type: 'audio/wav' }), 'audio');
  assert.equal(attachSlotFor({ type: 'application/pdf' }), null);
});

test('keeps the current model when it already takes the slot', () => {
  assert.equal(modelForAttachment([text, i2v], i2v, 'image'), i2v);
});

test('switches to the same kind, open and cheapest model', () => {
  assert.equal(modelForAttachment([text, edit, i2vGated, i2v, needsBoth], text, 'image'), i2v);
});

test('returns null when no model takes the slot', () => {
  assert.equal(modelForAttachment([text], text, 'audio'), null);
});

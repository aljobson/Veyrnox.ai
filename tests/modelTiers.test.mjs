import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { tierById, filterByTier } from '../app/veyrnox/_lib/modelTiers.js';

const page = readFileSync(new URL('../app/veyrnox/app/create/page.js', import.meta.url), 'utf8');

const models = [
  { id: 'a', credits: 1 },
  { id: 'b', credits: 2 },
  { id: 'c', credits: 5 },
  { id: 'd', credits: 5 },
  { id: 'e', credits: 20 },
  { id: 'f', credits: 40 },
];

test('splits distinct prices into low, medium and high thirds', () => {
  const t = tierById(models);
  assert.equal(t.get('a'), 'low');
  assert.equal(t.get('b'), 'low');
  assert.equal(t.get('c'), 'medium');
  assert.equal(t.get('e'), 'medium');
  assert.equal(t.get('f'), 'high');
});

test('models with the same price share a tier', () => {
  const t = tierById(models);
  assert.equal(t.get('c'), t.get('d'));
});

test('a null tier returns every model, a tier returns only its own', () => {
  assert.equal(filterByTier(models, null).length, models.length);
  assert.deepEqual(filterByTier(models, 'high').map((m) => m.id), ['f']);
});

test('a single model or an empty list does not throw', () => {
  assert.equal(tierById([{ id: 'x', credits: 3 }]).get('x'), 'low');
  assert.deepEqual(filterByTier([], 'low'), []);
});

test('the create page filters the model list by tier without hiding the selected model', () => {
  assert.match(page, /filterByTier\(/);
  assert.match(page, /aria-pressed=\{tier === t\}/);
});

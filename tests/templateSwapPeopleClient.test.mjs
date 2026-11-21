import test from 'node:test';
import assert from 'node:assert/strict';
import { createSwapStore } from '../app/veyrnox/_lib/templateSwapStore.mjs';
import { createSwapActions } from '../app/veyrnox/_lib/templateSwapActions.mjs';
import { fetchSwapAvailability, swapRequest } from '../app/veyrnox/_lib/templateSwapClient.mjs';
const png = name => Object.assign(new Blob([name], { type: 'image/png' }), { tag: name });
const two = { id: 'basketball-3', model: 'kling-o1-reference', credits: 47, durationSeconds: 5, role: 'the green character', roles: ['the green character', 'the red character'], people: 2, images: 4 };
const one = { id: 'community-athlete-identity-swap', model: 'kling-o1-reference', credits: 47, durationSeconds: 5, role: 'the main character', images: 2 };
function setup(offer = two) {
  const revoked = [], store = createSwapStore({ revoke: url => revoked.push(url) }); store.session('A');
  let n = 0; const posted = [], uploaded = [];
  const actions = createSwapActions(store, { makeKey: () => `key-${++n}`, processPhoto: async file => { if (file === 'bad') throw Error('no_face'); return ({ files: [png(`${file}-front`), png(`${file}-crop`)] }); },
    upload: async file => { uploaded.push(file.tag); return `uploads/${file.tag}`; }, objectURL: file => `blob:${file.tag}`, revokeURL: url => revoked.push(url),
    gateway: async (path, init) => { posted.push(JSON.parse(init.body)); return { job_id: 'job', balance_after: 1 }; } });
  return { store, actions, revoked, posted, uploaded, draft: () => store.get(offer.id).at(-1) };
}
test('availability accepts the one- and two-person offers and nothing in between', async () => {
  const ask = body => fetchSwapAvailability('x', async () => ({ status: 200, json: async () => ({ ...body, id: 'x' }) }));
  assert.ok(await ask(one)); assert.ok(await ask(two));
  for (const bad of [{ ...two, images: 2 }, { ...two, roles: ['a'] }, { ...two, roles: ['a', ''] }, { ...two, people: 3 }, { ...one, people: 2 }, { ...one, images: 4 }, { ...two, roles: undefined }]) assert.equal(await ask(bad), null);
});
test('a second person is added to the same draft; the first photo is kept', async () => {
  const { actions, draft, store, revoked } = setup();
  await actions.choose(two.id, 'a', 1);
  assert.equal(draft(), undefined, 'no second photo before the first');
  await actions.choose(two.id, 'a');
  assert.deepEqual(draft().urls, ['blob:a-front', 'blob:a-crop']);
  const key = draft().key;
  await actions.choose(two.id, 'b', 1);
  assert.equal(draft().key, key); assert.equal(draft().state, 'ready');
  assert.deepEqual(draft().urls, ['blob:a-front', 'blob:a-crop', 'blob:b-front', 'blob:b-crop']);
  await actions.choose(two.id, 'c', 0);
  assert.deepEqual(draft().urls, ['blob:c-front', 'blob:c-crop', 'blob:b-front', 'blob:b-crop']);
  assert.deepEqual(revoked, ['blob:a-front', 'blob:a-crop']);
  assert.equal(draft().files.length, 4); assert.equal(store.get(two.id).length, 1);
});
test('a failed second photo keeps the first and the retry targets the right person', async () => {
  const { actions, draft } = setup();
  await actions.choose(two.id, 'a');
  await actions.choose(two.id, 'bad', 1);
  assert.equal(draft().state, 'photo_error'); assert.equal(draft().errorCode, 'no_face'); assert.equal(draft().photoPerson, 1);
  assert.equal(draft().files.length, 2); assert.equal(draft().photo, 'bad');
  await actions.submit(two.id, two);
  assert.equal(draft().state, 'photo_error', 'not submittable with one person');
  await actions.choose(two.id, 'b', 1);
  assert.equal(draft().state, 'ready'); assert.equal(draft().files.length, 4); assert.equal(draft().errorCode, undefined);
});
test('submit needs both people: one photo does nothing, four photos upload in order and post four references', async () => {
  const { actions, draft, posted, uploaded } = setup();
  await actions.choose(two.id, 'a');
  await actions.submit(two.id, two);
  assert.equal(posted.length, 0); assert.deepEqual(uploaded, []);
  await actions.choose(two.id, 'b', 1);
  await actions.submit(two.id, two);
  assert.deepEqual(uploaded, ['a-front', 'a-crop', 'b-front', 'b-crop']);
  assert.equal(posted.length, 1);
  assert.deepEqual(posted[0].references.map(r => r.key), uploaded.map(tag => `uploads/${tag}`));
  assert.equal(posted[0].template_swap, two.id); assert.equal(posted[0].max_charge_credits, 47);
});
test('one-person templates behave as before', async () => {
  const { actions, draft, posted } = setup(one);
  await actions.choose(one.id, 'a');
  assert.equal(draft().files.length, 2);
  await actions.choose(one.id, 'b');
  assert.deepEqual(draft().urls, ['blob:b-front', 'blob:b-crop']);
  await actions.submit(one.id, one);
  assert.equal(posted[0].references.length, 2);
  assert.throws(() => swapRequest(one, 'k', [1, 2, 3, 4].map(i => ({ slot: 'image', origin: 'upload', key: `k${i}` }))), /invalid_swap_request/);
  assert.throws(() => swapRequest(two, 'k', [1, 2].map(i => ({ slot: 'image', origin: 'upload', key: `k${i}` }))), /invalid_swap_request/);
});

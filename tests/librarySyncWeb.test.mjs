import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchLibrarySync, pushFavourite, pushDraft, clearRemoteDraft } from '../app/veyrnox/_lib/librarySync.js';

const signedIn = () => ({ user: { id: 'u1' } });
const signedOut = () => null;
const J = '22222222-2222-4222-8222-222222222222';

test('signed out: nothing is asked and nothing is sent', async () => {
  let calls = 0; const fetcher = async () => { calls++; return {}; };
  assert.deepEqual(await fetchLibrarySync(fetcher, signedOut), { kind: 'unavailable' });
  assert.equal(await pushFavourite(J, true, fetcher, signedOut), false);
  assert.equal(await pushDraft({ v: 1 }, fetcher, signedOut), false);
  assert.equal(await clearRemoteDraft(fetcher, signedOut), false);
  assert.equal(calls, 0);
});

test('a refused or failing server (flag off is a 404) is "unavailable", never an error to the page', async () => {
  const boom = async () => { throw Object.assign(new Error('not_found'), { status: 404 }); };
  assert.deepEqual(await fetchLibrarySync(boom, signedIn), { kind: 'unavailable' });
  assert.equal(await pushFavourite(J, true, boom, signedIn), false);
  assert.equal(await pushDraft({ v: 1 }, boom, signedIn), false);
  assert.equal(await clearRemoteDraft(boom, signedIn), false);
});

test('the read is checked, so a bad server shape cannot reach the page', async () => {
  const out = await fetchLibrarySync(async () => ({ favourites: [J, 'x'], draft: { v: 1, modelId: 'veo-3', prompt: 'hi', evil: 1 } }), signedIn);
  assert.equal(out.kind, 'ok');
  assert.deepEqual(out.favourites, [J]);
  assert.equal(out.draft.evil, undefined);
});

test('requests go to the library-sync routes with ids and words in the body, never in the address', async () => {
  const seen = [];
  const fetcher = async (path, init) => { seen.push({ path, init }); return {}; };
  await pushFavourite(J, false, fetcher, signedIn);
  await pushDraft({ v: 1, modelId: 'veo-3', prompt: 'secret words' }, fetcher, signedIn);
  await clearRemoteDraft(fetcher, signedIn);
  assert.deepEqual(seen.map((s) => [s.path, s.init.method]), [['/library-sync/favourites', 'PUT'], ['/library-sync/draft', 'PUT'], ['/library-sync/draft', 'DELETE']]);
  assert.deepEqual(JSON.parse(seen[0].init.body), { job_id: J, starred: false });
  for (const s of seen) assert.equal(/secret|veo|22222222/.test(s.path), false);
});

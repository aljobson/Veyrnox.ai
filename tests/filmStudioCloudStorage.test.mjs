import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyFilm } from '../app/veyrnox/_lib/filmStudio.js';
import { parseFilm, readFilm, writeFilm, writeWorkspace, splitRecord, clearFilmLocal } from '../app/veyrnox/_lib/filmStudioStorage.js';

const id = '11111111-1111-4111-8111-111111111111';
const link = { userId: 'alice', id, revision: 2, savedText: 'never stored' };
const key = 'veyrnox_film_studio_v1:alice';
function storage() {
  const data = {};
  Object.defineProperties(data, { getItem: { value: k => data[k] ?? null }, setItem: { value: (k, v) => { data[k] = v; } }, removeItem: { value: k => { delete data[k]; } } });
  return data;
}
test('legacy films remain byte-identical and unlinked', () => {
  const store = storage(), film = { ...emptyFilm(), name: 'Legacy' }, text = JSON.stringify(film);
  store.setItem(key, text);
  assert.deepEqual(splitRecord(text, 'alice'), { text, cloud: null });
  assert.deepEqual(readFilm(store, 'alice'), { film, cloud: null, error: null });
  writeFilm(store, 'alice', film); assert.equal(store.getItem(key), text);
});
test('one atomic record preserves integer-like test keys and excludes snapshot/content from prefix', () => {
  const store = storage(), film = emptyFilm();
  film.assets = [{ tag: '@room', version: 1, type: 'location', descriptor: 'Private descriptor', references: [], tests: { '20': { result: 'twenty', verdict: 'pass' }, '2': { result: 'two', verdict: 'pass' }, angle: { result: 'side', verdict: 'pass' } }, lock: null }];
  film.name = 'Private name';
  let writes = 0;
  const wrapped = { getItem: store.getItem, setItem: (k, v) => { assert.equal(++writes, 1); store.setItem(k, v); } };
  writeWorkspace(wrapped, 'alice', film, link);
  const raw = store.getItem(key), record = splitRecord(raw, 'alice');
  assert.equal(record.text, JSON.stringify(film));
  assert.deepEqual(record.cloud, { userId: 'alice', id, revision: 2 });
  assert.equal(readFilm(store, 'alice').cloud.savedText, undefined);
  assert.equal(JSON.stringify(readFilm(store, 'alice').film), record.text);
  assert.doesNotMatch(raw.slice(0, raw.indexOf('},') + 2), /savedText|Private|schema/);
});
test('invalid user, uuid, revision and prefix make the entire record unreadable', () => {
  const store = storage(), film = emptyFilm();
  for (const bad of [{ ...link, userId: 'bob' }, { ...link, id: 'x'.repeat(36) }, { ...link, revision: 0 }, { ...link, revision: Number.MAX_SAFE_INTEGER + 1 }]) assert.throws(() => writeFilm(store, 'alice', film, bad));
  assert.equal(writeFilm(store, '../alice', film), false);
  const prefix = '{"cloudLink":{"userId":"alice","id":"' + id + '","revision":2},';
  for (const raw of [prefix.replace('alice', 'bob'), prefix.replace(id, 'x'.repeat(36)), prefix.replace(':2}', ':0}'), prefix.replace(':2}', ':9007199254740992}'), prefix.replace('"id":', '"id" :')]) {
    store.setItem(key, raw + JSON.stringify(film).slice(1));
    assert.ok(readFilm(store, 'alice').error); assert.equal(readFilm(store, 'alice').cloud, null);
  }
  store.setItem(key, '{bad'); assert.ok(readFilm(store, 'alice').error);
});
test('quota failure keeps the previous pair; a second-write fault cannot split the pair', () => {
  const store = storage(), a = { ...emptyFilm(), name: 'A' }, b = { ...emptyFilm(), name: 'B' };
  writeFilm(store, 'alice', a, link); const before = store.getItem(key);
  assert.throws(() => writeFilm({ setItem() { throw new Error('quota'); } }, 'alice', b, { ...link, revision: 3 }));
  assert.equal(store.getItem(key), before);
  let writes = 0;
  writeFilm({ setItem(k, v) { if (++writes === 2) throw new Error('quota'); store.setItem(k, v); } }, 'alice', b, { ...link, revision: 3 });
  assert.equal(writes, 1); assert.equal(readFilm(store, 'alice').film.name, 'B'); assert.equal(readFilm(store, 'alice').cloud.revision, 3);
});
test('sign-out clears the single prefixed record and leaves unrelated data', () => {
  const store = storage(); writeFilm(store, 'alice', emptyFilm(), link); store.other = 'keep';
  clearFilmLocal(store); assert.equal(store.getItem(key), null); assert.equal(store.other, 'keep');
});
test('reserved cloudLink is rejected in first, later, duplicate and null positions, including import', () => {
  const text = JSON.stringify(emptyFilm()), record = JSON.stringify({ userId: 'alice', id, revision: 1 });
  const attacks = ['{"cloudLink":' + record + ',' + text.slice(1), text.slice(0, -1) + ',"cloudLink":' + record + '}', '{"cloudLink":null,' + text.slice(1), '{"cloudLink":' + record + ',"cloudLink":null,' + text.slice(1)];
  for (const raw of attacks) {
    const store = storage();
    assert.throws(() => { const imported = parseFilm(raw); writeFilm(store, 'alice', imported); }, /not a valid Film Studio export/);
    assert.equal(store.getItem(key), null);
    store.setItem(key, '{"cloudLink":' + record + ',' + raw.slice(1));
    assert.ok(readFilm(store, 'alice').error); assert.equal(readFilm(store, 'alice').cloud, null);
  }
  assert.deepEqual(parseFilm(text), emptyFilm());
});

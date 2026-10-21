import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PUT } from '../app/api/v1/projects/[id]/document/route.js';
import { emptyProjectDocument, validProjectDocument } from '../lib/projectDocument.js';
import { ODDLINGS_SCHEMA_VERSION, jsonbTextBytes, validOddlingsProjectDocument as valid } from '../lib/projectOddlingsDocument.js';

const id = randomUUID();
const passport = (n = 0) => ({ id: `oddling-${n}`, savedAt: 1792500000000, name: 'Pip', picks: { oddling_name: 'Pip', hair: 'fluffy' }, motionId: 'wave' });
const document = () => ({ ...emptyProjectDocument(id), schema_version: 4, oddlings: { version: 1, items: [passport()], draft: null } });
const mutate = edit => { const doc = document(); edit(doc); return doc; };
const manyPicks = n => Object.fromEntries(Array.from({ length: n }, (_, i) => [`pick_${String.fromCharCode(97 + Math.floor(i / 26), 97 + i % 26)}`, 'soft']));

test('v4 accepts empty, full typical, and phone-shaped collections without widening editor documents', () => {
  assert.equal(ODDLINGS_SCHEMA_VERSION, 4);
  const doc = document();
  assert.equal(valid(doc, id), true);
  assert.equal(validProjectDocument(doc, id), false);
  doc.oddlings.items = [];
  assert.equal(valid(doc, id), true);
  doc.oddlings.items = Array.from({ length: 24 }, (_, i) => passport(i));
  doc.oddlings.draft = { savedAt: 1e14, picks: { oddling_name: 'Next Oddling', backstory: 'A quiet friend.' } };
  assert.equal(valid(doc, id), true);
  doc.oddlings.items[0].motionId = '';
  doc.oddlings.items[0].savedAt = 0;
  assert.equal(valid(doc, id), true);
});

test('shape, identity, timestamp, text and collection bounds reject malformed v4 documents', () => {
  const cases = [
    ['extra top-level key', d => { d.extra = true; }],
    ['missing oddlings', d => { delete d.oddlings; }],
    ['version 2', d => { d.oddlings.version = 2; }],
    ['25 items', d => { d.oddlings.items = Array.from({ length: 25 }, (_, i) => passport(i)); }],
    ['duplicate id', d => { d.oddlings.items.push(passport()); }],
    ['item extra key', d => { d.oddlings.items[0].extra = true; }],
    ['bad id', d => { d.oddlings.items[0].id = 'bad/id'; }],
    ['bad pick key', d => { d.oddlings.items[0].picks = { Hair: 'soft' }; }],
    ['long pick', d => { d.oddlings.items[0].picks.hair = 'a'.repeat(161); }],
    ['non-string pick', d => { d.oddlings.items[0].picks.hair = 1; }],
    ['65 picks', d => { d.oddlings.items[0].picks = manyPicks(65); }],
    ['bad draft', d => { d.oddlings.draft = { savedAt: 0, picks: {}, extra: true }; }],
    ['other project', d => { d.project_id = randomUUID(); }],
    ['over byte limit', d => { d.oddlings.items = Array.from({ length: 24 }, (_, i) => ({ ...passport(i), picks: Object.fromEntries(Object.keys(manyPicks(64)).map(k => [k, '界'.repeat(160)])) })); }],
    ['missing item field', d => { delete d.oddlings.items[0].motionId; }],
    ['missing draft', d => { delete d.oddlings.draft; }],
    ['extra collection field', d => { d.oddlings.extra = true; }],
    ['null item', d => { d.oddlings.items = [null]; }],
    ['non-array items', d => { d.oddlings.items = {}; }],
    ['null picks', d => { d.oddlings.items[0].picks = null; }],
    ['empty name', d => { d.oddlings.items[0].name = ''; }],
    ['long name', d => { d.oddlings.items[0].name = 'a'.repeat(41); }],
    ['bad motion', d => { d.oddlings.items[0].motionId = 'Wave'; }],
    ...[-1, 1e14 + 1, 0.5, '1', null].flatMap(savedAt => [
      [`item timestamp ${savedAt}`, d => { d.oddlings.items[0].savedAt = savedAt; }],
      [`draft timestamp ${savedAt}`, d => { d.oddlings.draft = { savedAt, picks: {} }; }],
    ]),
    ['control in brief', d => { d.brief = 'line\nbreak'; }],
    ['control in name', d => { d.oddlings.items[0].name = 'Pip\t'; }],
    ['control in pick', d => { d.oddlings.items[0].picks.hair = '\u0000'; }],
    ['control in key', d => { d.oddlings.items[0].picks = { 'hair\n': 'soft' }; }],
  ];
  for (const [label, edit] of cases) assert.equal(valid(mutate(edit), id), false, label);
  for (const value of [null, [], 4, 'v4']) assert.equal(valid(value, id), false);
});

test('every string rejects lone/reversed surrogates, but complete emoji pairs remain valid', () => {
  for (const bad of ['abc\uD83D', '\uDE00abc', '\uDE00\uD83D']) {
    for (const edit of [
      d => { d.oddlings.items[0].name = bad; },
      d => { d.oddlings.items[0].picks.hair = bad; },
      d => { d.oddlings.items[0].id = bad; },
      d => { d.oddlings.items[0].motionId = bad; },
      d => { d.oddlings.items[0].picks = { [bad]: 'soft' }; },
      d => { d.brief = bad; },
      d => { d.oddlings.draft = { savedAt: 1, picks: { hair: bad } }; },
    ]) assert.equal(valid(mutate(edit), id), false);
  }
  for (const name of ['Pip 😀', 'a'.repeat(38) + '😀']) assert.equal(valid(mutate(d => { d.oddlings.items[0].name = name; }), id), true);
  assert.equal(valid(mutate(d => { d.oddlings.items[0].name = 'a'.repeat(39) + '😀'; }), id), false);
  assert.equal(jsonbTextBytes('😀'), 6); // Four UTF-8 bytes and two quotes.
});

test('jsonbTextBytes includes spaces, empty containers, escaped and multibyte strings', () => {
  for (const [value, stored] of [
    [{ a: 1, b: [1, 2] }, '{"a": 1, "b": [1, 2]}'],
    [{ a: {}, b: [] }, '{"a": {}, "b": []}'],
    [{ a: ['界😀', '"\\'] }, '{"a": ["界😀", "\\\"\\\\"]}'],
  ]) assert.equal(jsonbTextBytes(value), new TextEncoder().encode(stored).byteLength);
  assert.equal(jsonbTextBytes({ a: 1, b: [1, 2] }), 21);
});

test('stored size accepts 32768 bytes and rejects 32769 even when compact JSON fits', () => {
  const doc = document();
  doc.oddlings.items = Array.from({ length: 3 }, (_, i) => ({ ...passport(i), picks: Object.fromEntries(Object.keys(manyPicks(64)).map(k => [k, 'x'.repeat(140)])) }));
  doc.brief = 'x'.repeat(32768 - jsonbTextBytes(doc));
  assert.equal(jsonbTextBytes(doc), 32768);
  assert.equal(valid(doc, id), true);
  doc.brief += 'x';
  assert.equal(jsonbTextBytes(doc), 32769);
  assert.ok(new TextEncoder().encode(JSON.stringify(doc)).byteLength < 32768);
  assert.equal(valid(doc, id), false);
});

test('PUT gates v4 before validation, validates Unicode, and forwards valid documents with the user JWT', async () => {
  const vars = { APP_ENV: 'development', PUBLIC_HOST: 'http://localhost:3000', SUPABASE_URL: 'http://127.0.0.1:54321', NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'sb_publishable_local_test', TENANT_PROJECTS_ENABLED: 'true', EDITOR_RUNTIME_FLAGS: '{}', PROJECT_ODDLINGS_ENABLED: undefined };
  const old = Object.fromEntries(Object.keys(vars).map(key => [key, process.env[key]])), originalFetch = globalThis.fetch;
  const request = body => new Request(`http://localhost:3000/api/v1/projects/${id}/document`, { method: 'PUT', headers: { authorization: 'Bearer test-user', 'x-veyrnox-auth-id': randomUUID(), 'x-request-id': randomUUID(), 'content-type': 'application/json', 'idempotency-key': 'oddling-test-key' }, body: JSON.stringify(body) });
  const put = body => PUT(request(body), { params: Promise.resolve({ id }) });
  const apply = values => { for (const [key, value] of Object.entries(values)) if (value === undefined) delete process.env[key]; else process.env[key] = value; };
  let calls = 0, sent;
  try {
    apply(vars);
    globalThis.fetch = async (url, init) => { calls++; sent = JSON.parse(init.body); assert.match(String(url), /rpc\/save_project_document$/); assert.equal(init.headers.authorization, 'Bearer test-user'); return Response.json({ revision: 1, document: sent.p_document }); };
    for (const doc of [document(), { schema_version: 4 }]) {
      const response = await put({ expected_revision: 0, document: doc });
      assert.equal(response.status, 404); assert.equal((await response.json()).error.code, 'NOT_FOUND');
    }
    assert.equal(calls, 0);
    process.env.EDITOR_RUNTIME_FLAGS = '{"oddlings":"true"}';
    for (const doc of [{ schema_version: 4 }, mutate(d => { d.oddlings.items[0].name = 'abc\uD83D'; })]) {
      const response = await put({ expected_revision: 0, document: doc });
      assert.equal(response.status, 400); assert.equal((await response.json()).error.code, 'INVALID_DOCUMENT');
    }
    assert.equal(calls, 0);
    const doc = document();
    assert.equal((await put({ expected_revision: 0, document: doc })).status, 200);
    assert.deepEqual(sent, { p_project_id: id, p_expected_revision: 0, p_document: doc, p_idempotency_key: 'oddling-test-key', p_restore_revision: null });
    process.env.EDITOR_RUNTIME_FLAGS = '{}';
    assert.equal((await put({ expected_revision: 0, document: emptyProjectDocument(id) })).status, 200);
    assert.equal(sent.p_document.schema_version, 1);
    assert.equal((await put({ expected_revision: 1, restore_revision: 1 })).status, 200);
    assert.equal(sent.p_document, null); assert.equal(sent.p_restore_revision, 1);
  } finally { globalThis.fetch = originalFetch; apply(old); }
});

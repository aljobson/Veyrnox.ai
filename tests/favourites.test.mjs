import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readFavourites, toggleFavourite, MAX_FAVOURITES } from '../app/veyrnox/_lib/favourites.js';
import { filterRows } from '../app/veyrnox/_lib/libraryFilter.js';

const store = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), m }; };
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const USER = 'user-1';

test('starring and unstarring a job persists per account', () => {
    const s = store();
    assert.deepEqual(toggleFavourite(s, USER, A), [A]);
    assert.deepEqual(toggleFavourite(s, USER, B), [B, A], 'newest first');
    assert.deepEqual(readFavourites(s, USER), [B, A]);
    assert.deepEqual(readFavourites(s, 'user-2'), [], 'another account sees none');
    assert.deepEqual(toggleFavourite(s, USER, A), [B]);
});

test('signed out, a bad id or blocked storage changes nothing and never throws', () => {
    const s = store();
    assert.deepEqual(toggleFavourite(s, null, A), []);
    assert.deepEqual(toggleFavourite(s, USER, 'not-a-uuid'), []);
    assert.equal(s.m.size, 0);
    const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
    assert.deepEqual(readFavourites(blocked, USER), []);
    assert.deepEqual(toggleFavourite(blocked, USER, A), []);
    const readOnly = { getItem: () => JSON.stringify([B]), setItem() { throw new Error('full'); } };
    assert.deepEqual(toggleFavourite(readOnly, USER, A), [B], 'unsaved star is not shown as saved');
});

test('stored junk is dropped and the list is capped', () => {
    const s = store();
    s.setItem('veyrnox_favourites_v1:' + USER, JSON.stringify([A, 42, 'x', null]));
    assert.deepEqual(readFavourites(s, USER), [A]);
    s.setItem('veyrnox_favourites_v1:' + USER, '{not json');
    assert.deepEqual(readFavourites(s, USER), []);
    const many = Array.from({ length: MAX_FAVOURITES + 5 }, (_, i) => `${String(i).padStart(8, '0')}-1111-4111-8111-111111111111`);
    s.setItem('veyrnox_favourites_v1:' + USER, JSON.stringify(many));
    assert.equal(readFavourites(s, USER).length, MAX_FAVOURITES);
});

test('the favourites filter combines with the others and is off by default', () => {
    const rows = [{ job_id: A, state: 'succeeded' }, { job_id: B, state: 'failed' }];
    assert.equal(filterRows(rows, {}, []).length, 2);
    assert.deepEqual(filterRows(rows, { favourites: [B] }, []).map((r) => r.job_id), [B]);
    assert.deepEqual(filterRows(rows, { favourites: [B], state: 'succeeded' }, []), []);
    assert.deepEqual(filterRows(rows, { favourites: [] }, []), []);
});

test('the Library offers a star on each card and a Favourites filter', () => {
    const page = readFileSync(new URL('../app/veyrnox/app/library/page.js', import.meta.url), 'utf8');
    assert.match(page, /favourites: favOnly \? favourites : null/);
    assert.match(page, /aria-label=\{starred \? 'Remove from favourites' : 'Add to favourites'\}/);
    assert.ok(page.split('\n').length <= 500, 'library page stays under 500 lines');
});

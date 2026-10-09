// Chat folders on the screen: which chats the list shows for a search and a folder choice.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ALL_CHATS, UNFILED, folderLabel, visibleThreads } from '../app/veyrnox/_lib/chatFolders.js';

const T = (id, title, folder_id = null, pinned = false, updated_at = '2026-10-05T10:00:00Z') => ({ id, title, folder_id, pinned, updated_at });
const threads = [
    T('a', 'Tax questions', 'work', false, '2026-10-05T09:00:00Z'), T('b', 'Dinner ideas', null, false, '2026-10-05T12:00:00Z'),
    T('c', 'Roadmap', 'work', true, '2026-10-05T08:00:00Z'), T('d', 'Gift list', 'home', false, '2026-10-05T11:00:00Z'),
];
const ids = (xs) => xs.map((t) => t.id);

test('all chats shows everything, pinned first then newest', () => {
    assert.deepEqual(ids(visibleThreads(threads, { query: '', folder: ALL_CHATS })), ['c', 'b', 'd', 'a']);
});

test('a folder shows only its chats, and Unfiled shows only chats in no folder', () => {
    assert.deepEqual(ids(visibleThreads(threads, { query: '', folder: 'work' })), ['c', 'a']);
    assert.deepEqual(ids(visibleThreads(threads, { query: '', folder: UNFILED })), ['b']);
    assert.deepEqual(visibleThreads(threads, { query: '', folder: 'gone' }), [], 'a folder that no longer exists shows nothing');
});

test('search narrows within the chosen folder and ignores case and surrounding space', () => {
    assert.deepEqual(ids(visibleThreads(threads, { query: '  TAX ', folder: 'work' })), ['a']);
    assert.deepEqual(ids(visibleThreads(threads, { query: 'tax', folder: 'home' })), []);
    assert.deepEqual(ids(visibleThreads(threads, { query: 'list', folder: ALL_CHATS })), ['d']);
});

test('the input is not mutated', () => {
    const before = JSON.stringify(threads);
    visibleThreads(threads, { query: '', folder: ALL_CHATS });
    assert.equal(JSON.stringify(threads), before);
});

test('folderLabel names a choice, with its count', () => {
    const folders = [{ id: 'work', name: 'Work', count: 2 }];
    assert.equal(folderLabel(ALL_CHATS, folders, 4), 'All chats (4)');
    assert.equal(folderLabel(UNFILED, folders, 1), 'Unfiled (1)');
    assert.equal(folderLabel('work', folders, 4), 'Work (2)');
    assert.equal(folderLabel('gone', folders, 4), 'All chats (4)', 'a missing folder falls back to all chats');
});

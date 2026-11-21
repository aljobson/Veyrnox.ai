// ATT-03: images picked for one chat must never go out with another chat's message. The composer's attachments are dropped
// whenever a different chat is opened or New chat is pressed, and frames still being read from a video picked before that
// are discarded when they arrive.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workspace = readFileSync(new URL('../app/veyrnox/_components/chat/ChatWorkspace.js', import.meta.url), 'utf8');
const attachBar = readFileSync(new URL('../app/veyrnox/_components/chat/AttachBar.js', import.meta.url), 'utf8');

const body = (src, start) => { const i = src.indexOf(start); assert.ok(i >= 0, start); return src.slice(i, src.indexOf('\n  };', i) + 1 || undefined); };

test('opening a different chat drops the images picked for the one that was on screen', () => {
    const open = workspace.slice(workspace.indexOf('const open = async (id) => {'), workspace.indexOf('const settleNew'));
    assert.match(open, /const switched = chatView\.current\.shown !== id;/);
    assert.match(open, /if \(switched\) \{ att\.clear\(\);/);
    assert.ok(open.indexOf('const switched') < open.indexOf('land(chatView.current, id)'), 'compared before the new chat lands');
});

test('New chat starts with no images', () => {
    const line = workspace.split('\n').find((l) => l.trimStart().startsWith('const clear = () =>'));
    assert.ok(line, 'clear() exists');
    assert.match(line, /att\.clear\(\);/);
});

test('frames read from a video picked before the images were cleared are not added', () => {
    assert.match(attachBar, /const generation = useRef\(0\);/);
    const addVideo = body(attachBar, 'const addVideo = useCallback');
    assert.match(addVideo, /const started = generation\.current;/);
    assert.match(addVideo, /if \(generation\.current !== started\) return;/);
    const clear = attachBar.slice(attachBar.indexOf('const clear = useCallback'), attachBar.indexOf('const addAsset'));
    assert.match(clear, /generation\.current \+= 1;/);
});

// ATT-REVIEW-01: a Library pick reads the image's size first, which is slow. A chat opened meanwhile must not receive it.
import { admitLibraryImage } from '../app/veyrnox/_lib/chatImages.js';

function scope() {
    let generation = 0;
    return { stamp: () => generation, isCurrent: (since) => since === generation, clear: () => { generation += 1; } };
}

test('a Library image whose size arrives after the images were cleared is dropped', async () => {
    const s = scope(); const added = []; const notices = [];
    let loaded; const measure = () => new Promise((resolve) => { loaded = resolve; });
    const since = s.stamp();
    const pick = admitLibraryImage({ id: 'job-a', url: 'https://r2/a' }, { since, isCurrent: s.isCurrent, measure, maxEdge: 2048, tooBig: (x) => notices.push(x), add: (it) => added.push(it) });
    s.clear(); // another chat opened while the image loads
    loaded({ w: 4000, h: 4000 });
    assert.equal(await pick, 'stale');
    assert.deepEqual(added, []);
    assert.deepEqual(notices, [], 'no notice about a pick from a chat no longer on screen');
});

test('a Library image still on its own chat is added, or refused when over the cap', async () => {
    const s = scope(); const added = []; const notices = [];
    const base = { isCurrent: s.isCurrent, maxEdge: 2048, tooBig: (x) => notices.push(x), add: (it) => added.push(it) };
    assert.equal(await admitLibraryImage({ id: 'ok' }, { ...base, since: s.stamp(), measure: async () => ({ w: 1024, h: 768 }) }), 'added');
    assert.equal(await admitLibraryImage({ id: 'big' }, { ...base, since: s.stamp(), measure: async () => ({ w: 4096, h: 10 }) }), 'too_big');
    assert.equal(await admitLibraryImage({ id: 'unread' }, { ...base, since: s.stamp(), measure: async () => null }), 'added');
    assert.deepEqual(added.map((a) => a.id), ['ok', 'unread']);
    assert.deepEqual(notices, [{ w: 4096, h: 10 }]);
});

test('the ?asset handoff and the Library picker both carry the stamp taken before their slow steps', () => {
    const handoff = workspace.slice(workspace.indexOf("get('asset')"), workspace.indexOf('const skillFromUrl'));
    assert.ok(handoff.indexOf('const since = att.stamp()') >= 0 && handoff.indexOf('const since = att.stamp()') < handoff.indexOf('await gatewayFetch'));
    assert.match(handoff, /if \(!att\.isCurrent\(since\)\) return;/);
    assert.match(handoff, /await pickFromLibrary\(\{.*\}, since\);/);
    assert.match(workspace, /async function pickFromLibrary\(it, since = att\.stamp\(\)\)/);
    assert.match(workspace, /admitLibraryImage\(it, \{\s*since, isCurrent: att\.isCurrent/);
});

// ATT-REVIEW-02: a Library picker opened for one chat must not hand its pick to another. It closes when the chat changes, and
// a pick carries the stamp taken when the picker opened, not when the image was chosen.
test('a Library picker opened for one chat cannot add to another', () => {
    const open = workspace.slice(workspace.indexOf('const open = async (id) => {'), workspace.indexOf('const settleNew'));
    assert.match(open, /if \(switched\) \{ att\.clear\(\); setPickingLibrary\(false\); \}/);
    const line = workspace.split('\n').find((l) => l.trimStart().startsWith('const clear = () =>'));
    assert.match(line, /att\.clear\(\); setPickingLibrary\(false\);/);
    assert.match(workspace, /onLibrary=\{\(\) => \{ libraryStamp\.current = att\.stamp\(\); setPickingLibrary\(true\); \}\}/);
    assert.match(workspace, /<LibraryPicker onPick=\{\(it\) => pickFromLibrary\(it, libraryStamp\.current\)\}/);
});

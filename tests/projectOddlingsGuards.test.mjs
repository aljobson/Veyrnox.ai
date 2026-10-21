import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isOddlingsDocument } from '../lib/projectOddlingsDocument.js';
import { appMessagesFor } from '../lib/i18n/appMessages.mjs';
import { translator } from '../lib/i18n/translate.mjs';
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
// Supplementary source checks: the DB kind lock is the enforcing boundary.
const body = (source, start, end) => {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `locate ${start}`);
  return source.slice(from, to);
};

test('isOddlingsDocument recognizes only numeric schema version 4', () => {
  assert.equal(isOddlingsDocument({ schema_version: 4 }), true);
  for (const doc of [undefined, null, {}, [], 4, { schema_version: '4' }, ...[1, 2, 3, 5].map(schema_version => ({ schema_version }))]) assert.equal(isOddlingsDocument(doc), false);
});

test('editor guards every adoption and save path before changing the timeline or project', () => {
  const source = read('../app/veyrnox/_components/editor/ProjectBar.js');
  for (const [start, end, adoption] of [
    ['const open =', '    useEffect(() =>', 'timelineFromDocument(d.document)'],
    ['async function attach(', 'async function createProject(', 'window.history.replaceState'],
    ['function loadRemote(', 'async function keepLocalCopy(', 'timelineFromDocument(remote.document)'],
    ['const save =', '// Autosave', 'documentForTimeline(doc, tl)'],
  ]) {
    const fn = body(source, start, end);
    assert.match(fn, /isOddlingsDocument\(/);
    assert.ok(fn.indexOf('isOddlingsDocument(') < fn.indexOf(adoption), start);
    if (!start.includes('save')) assert.match(fn, /app\.editor\.project\.unavailable/);
    if (start.includes('loadRemote')) for (const clear of ['setProjectId(null)', 'setDoc(null)', 'setRemote(null)']) assert.ok(fn.includes(clear));
  }
  const save = body(source, 'const save =', '// Autosave');
  assert.ok(save.indexOf('isOddlingsDocument(r.document)') < save.indexOf('setDoc(r.document)'));
  for (const clear of ['setProjectId(null)', 'setDoc(null)', 'setRemote(null)']) assert.ok(save.includes(clear));
});

test('project page refuses v4 in load, remote review and acceptRemote; its existing string resolves', async () => {
  const source = read('../app/veyrnox/app/projects/[id]/page.js');
  for (const [start, end, adoption] of [
    ['const [p,d]=await', 'readHistory();', 'setDraft(d.document)'],
    ['async function reviewLatest(', 'async function viewVersion(', 'setRemote(r)'],
    ['function acceptRemote(', '  return <div', 'setDraft(remote.document)'],
  ]) {
    const fn = body(source, start, end);
    assert.match(fn, /isOddlingsDocument\(/);
    assert.match(fn, /setLoadError\(t\("app\.editor\.project\.unavailable"\)\)/);
    assert.ok(fn.indexOf('isOddlingsDocument(') < fn.indexOf(adoption));
  }
  assert.match(body(source, 'const save=useCallback', 'async function reviewLatest'), /if\(loadError\|\|/);
  const t = translator('en', await appMessagesFor('en'));
  assert.equal(t('app.editor.project.unavailable'), 'This project is not available here.');
});

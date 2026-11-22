import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Keys pressed inside a modal <dialog> (shortcuts, export, credits) belong to that dialog. The workspace key handler used
// to run Escape's preventDefault (clear selection) for them, which cancelled the dialog's native cancel, and let Delete,
// Space, undo and the other shortcuts act on the timeline behind the dialog. The browser behaviour is proven by
// e2e/authenticated-editor-dialog-keys.spec.mjs; this pins the guard where it lives.
const source = readFileSync(new URL('../app/veyrnox/_components/editor/MultitrackWorkspace.js', import.meta.url), 'utf8');

function keysHandler() {
  const start = source.indexOf('function keys(event)');
  assert.ok(start > 0, 'the workspace key handler exists');
  const end = source.indexOf("else if(key==='l'&&total)", start);
  assert.ok(end > start, 'the handler still ends with its transport shortcuts');
  return source.slice(start, end);
}

test('workspace shortcuts ignore keystrokes whose target is inside a dialog', () => {
  const handler = keysHandler();
  const guard = handler.slice(0, handler.indexOf('const mod'));
  assert.match(guard, /event\.target\.closest\('[^']*\bdialog\b[^']*'\)/, 'dialog-originated keys return before any shortcut runs');
  assert.match(guard, /\breturn\b/);
});

test('the workspace still handles Escape (clear selection) and Delete for keys outside dialogs', () => {
  const handler = keysHandler();
  assert.match(handler, /key==='escape'\)\{event\.preventDefault\(\);setSelected\(null\);setSelection\(\[\]\);\}/);
  assert.match(handler, /\['delete', 'backspace'\]\.includes\(key\) && item\) \{ event\.preventDefault\(\); remove\(\);/);
});

test('the guard runs before every shortcut: no preventDefault precedes it', () => {
  const handler = keysHandler();
  assert.ok(handler.indexOf('dialog') < handler.indexOf('preventDefault'));
});

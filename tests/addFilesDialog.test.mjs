import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as React from 'react';
import { appMessagesFor } from '../lib/i18n/appMessages.mjs';
import { fixture } from './helpers/publicSiteRender.mjs';
import { visibleText } from './helpers/visibleText.mjs';

const FILE = 'app/veyrnox/_components/AddFilesDialog.js';
function render(locale, messages, capacity) {
  const f = fixture(locale, '/app/create', { messages, signedIn: true });
  return f.render(React.createElement(f.load(FILE).AddFilesDialog, { capacity, onAdd() {}, onClose() {} }));
}

test('Add files shows upload, both tabs and a counter for each kind the model takes', async () => {
  const text = visibleText(render('en', await appMessagesFor('en'), { image: 2, video: 1, audio: 0 }));
  for (const part of ['Add files', 'Upload files or drag them here', '+ Upload file', 'Generated', 'Uploaded', 'All', 'Images0/2', 'Videos0/1', 'Cancel', 'Add']) assert.ok(text.includes(part), part);
  assert.ok(!text.includes('Audios'), 'a kind the model cannot take has no filter');
});

test('Add files renders translated copy with no raw keys', async () => {
  for (const locale of ['de', 'ja', 'ar']) {
    const html = render(locale, await appMessagesFor(locale), { image: 3, video: 3, audio: 3 });
    assert.doesNotMatch(html, /app\.create\.addFiles\./, locale);
  }
});

test('Create opens Add files from its button and from a template, keeping a template model that takes files', () => {
  const page = readFileSync('app/veyrnox/app/create/page.js', 'utf8');
  assert.match(page, /data-testid="create-add-files"[^>]*onClick=\{\(\) => setAddFilesOpen\(true\)\}/);
  assert.match(page, /onChooseSource=\{\(\) => setAddFilesOpen\(true\)\}/);
  assert.match(page, /<AddFilesDialog capacity=\{attachCapacity\(model\)\} onAdd=\{attachFiles\}/);
  assert.match(page, /const pool = currentModel && Object\.keys\(currentModel\.media \|\| \{\}\)\.length \? \[currentModel\] : currentModels;/);
});

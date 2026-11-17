import { shortcutKeys } from '../app/veyrnox/_lib/music/beat/beatShortcuts.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import ts from 'typescript';
import { existsSync, readFileSync } from 'node:fs';
import { translator } from '../lib/i18n/translate.mjs';
import { beatErrorMessage, beatFailure } from '../app/veyrnox/_lib/music/beat/beatErrors.mjs';
import { beatEnglish, beatText } from '../app/veyrnox/_lib/music/beat/beatDisplay.mjs';
import { formatPosition, formatNoteLength } from '../app/veyrnox/_lib/music/beat/beatTime.mjs';
import { audioLoopLabel } from '../app/veyrnox/_lib/music/beat/beatPlaybackAudio.mjs';
import { trackSummary } from '../app/veyrnox/_lib/music/beat/beatTrackSummary.mjs';
import { versionReason, versionTime } from '../app/veyrnox/_lib/music/beat/beatVersionLabels.mjs';
import { actionLabel, recordedNotesLabel } from '../app/veyrnox/_lib/music/beat/beatActionLabels.mjs';
import { candidates } from '../scripts/audit-public-i18n.mjs';

test('browser, storage and HTTP exception text never becomes error copy', () => {
  for (const fallback of ['playback', 'render', 'capture', 'seed', 'save-take']) {
    for (const error of [new Error('PRIVATE backend diagnostic'), { code: 'unknown', message: 'PRIVATE storage diagnostic' }]) {
      assert.equal(beatErrorMessage(error, fallback), beatEnglish(`app.music.beat.error.${fallback}`));
      assert.doesNotMatch(beatErrorMessage(error, fallback), /PRIVATE/);
    }
  }
  const error = beatFailure('device-limit');
  assert.equal(error.message, 'This device has 50 beats. Delete one to make room.');
  assert.equal(beatErrorMessage(error), error.message);
});
for (const locale of ['es', 'ar', 'de']) test(`${locale}: helper labels and typed recovery messages use the requested catalog`, async () => {
  const { default: messages } = await import(`../lib/i18n/messages/app/${locale}.mjs`);
  const t = translator(locale, messages);
  const error = beatFailure('recovery-r87', { count: 1 });
  assert.equal(error.message, '1 sound is missing and will be silent. Choose Download or Save again to continue.');
  assert.equal(beatErrorMessage(error, 'render', t), t('app.music.beat.recovery.missingSounds.one', { count: 1 }));
  assert.notEqual(formatPosition(3840, t), formatPosition(3840));
  assert.notEqual(formatNoteLength(3840, t, locale), formatNoteLength(3840));
  assert.notEqual(audioLoopLabel({ length: 3840 }, { durationSec: 2 }, 120, t, locale), audioLoopLabel({ length: 3840 }, { durationSec: 2 }, 120));
  assert.notEqual(trackSummary([{ kind: 'audio' }], t, locale), '1 audio track');
  assert.notEqual(versionReason('conflict', t), versionReason('conflict'));
  assert.ok(versionTime('2026-11-17T12:00:00Z', new Date('2026-11-17T13:00:00Z'), t, locale).startsWith(t('app.music.beat.shared.today')));
  assert.equal(shortcutKeys({ keys: 'Mod+Space / Home' }, { platform: 'MacIntel' }, t), `⌘+${t('app.music.beat.key.Space')} / ${t('app.music.beat.key.Home')}`);
  assert.equal(recordedNotesLabel(3), 'Recorded 3 notes');
  assert.equal(actionLabel(recordedNotesLabel(3), t), t('app.music.beat.status.s84', { p0: 3 }));
  assert.equal(beatText('Stop recording to edit', t), t('app.music.beat.status.s10'));
});
test('audit also catches untranslated announcements in JSX-free beat hooks and helpers', () => {
  for (const file of ['app/veyrnox/_components/music/beat/useBeatFixture.js', 'app/veyrnox/_lib/music/beat/beatFixture.mjs']) {
    assert.ok(candidates(file, "export function announceFixture(announce) { announce('Untranslated recovery announcement'); }", { app: true }).some(r => r.status === 'unresolved'));
  }
  const source = readFileSync('app/veyrnox/_components/music/beat/BeatRecordPanel.jsx', 'utf8');
  assert.doesNotMatch(source, /displayError\s*\?\?\s*recorder\.error/);
});

test('server-shared document validation cannot reach a beat catalog', () => {
  const seen = new Set();
  function visit(file) {
    if (seen.has(file)) return;
    seen.add(file);
    assert.doesNotMatch(file, /i18n\/messages\/app\/[^/]+\/music-beat-/);
    const tree = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    for (const statement of tree.statements) {
      if (!(ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement))) continue;
      const specifier = statement.moduleSpecifier?.text;
      if (!specifier?.startsWith('.')) continue;
      const base = path.join(path.dirname(file), specifier);
      const target = [base, `${base}.js`, `${base}.mjs`, `${base}.jsx`].find(existsSync);
      if (target) visit(target);
    }
  }
  visit('app/veyrnox/_lib/music/beat/beatDocument.mjs');
});

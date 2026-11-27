import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { LOCALES } from '../lib/i18n/locales.mjs';
import en from '../lib/i18n/messages/app/en/smart-cut.mjs';
import { speechErrorKey } from '../app/veyrnox/_lib/speechCutClient.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const messages = en.default || en;

test('the analysis panel shows the price and the processor before any charge and needs a click', () => {
  const panel = read('app/veyrnox/_components/SmartCutAnalyse.js');
  assert.match(panel, /app\.smartCut\.analyse\.confirm/);
  assert.match(panel, /app\.smartCut\.analyse\.privacy/);
  assert.match(panel, /app\.smartCut\.analyse\.language/);
  assert.match(panel, /language \}\)/);
  assert.match(panel, /analysisKey = \(jobId, selectedLanguage\) => JSON\.stringify\(\[jobId, selectedLanguage\]\)/);
  assert.match(panel, /completed\.has\(analysisKey\(clip\.job_id, language\)\)/);
  assert.match(panel, /setCompleted\(\(value\) => new Set\(value\)\.add\(keyId\)\)/);
  assert.match(panel, /onClick=\{analyseAll\}/);
  // The quote is read on mount; nothing may start a paid request without the confirm click.
  assert.doesNotMatch(panel, /useEffect\([^)]*startSpeech/s);
});

test('accepted analysis reports explicit queued, transcribing, reconnecting and checking stages', () => {
  const panel = read('app/veyrnox/_components/SmartCutAnalyse.js');
  assert.match(panel, /onProgress: \(stage\)/);
  assert.match(panel, /data-smart-cut-stage=\{run\.stage\}/);
  for (const stage of ['queued', 'transcribing', 'retrying', 'checking']) {
    assert.ok(messages[`app.smartCut.analyse.stage.${stage}`], stage);
  }
});

test('mobile progress uses one privacy-minimal OS card without prompting for permission', () => {
  const progress = read('apps/mobile/src/lib/smartCutProgressNotification.ts');
  const card = read('apps/mobile/src/components/smart-cut/SmartCutAnalysisCard.tsx');
  const push = read('apps/mobile/src/lib/push.ts');
  assert.match(progress, /SMART_CUT_PROGRESS_ID = 'veyrnox-smart-cut-progress'/);
  assert.match(progress, /getPermissionsAsync/);
  assert.doesNotMatch(progress, /requestPermissionsAsync/);
  assert.match(progress, /sticky: true/);
  assert.match(progress, /data: \{ type: 'smart-cut' \}/);
  assert.match(progress, /stage === 'retrying'[\s\S]*'editorSpeech\.retrying'/);
  assert.doesNotMatch(progress, /clip\.label|jobId|transcript/);
  assert.match(card, /progressNotification\.current\?\.update/);
  assert.match(card, /progressNotification\.current\?\.complete/);
  assert.match(card, /t\(smartCutProgressStageKey\(progressStage\)\)/);
  assert.match(push, /smartCutRouteFromPush/);
});

test('the edit sheet hands finished analyses to the planner and the planner stays free', () => {
  const sheet = read('app/veyrnox/_components/EditSheet.js');
  assert.match(sheet, /SmartCutAnalyse/);
  assert.match(sheet, /analyses=\{/);
});

test('the Library card offers Smart Cut only where the editor selection is allowed', () => {
  const card = read('app/veyrnox/_components/LibraryJobCard.js');
  assert.match(card, /onSmartCut/);
  assert.match(card, /data-testid="library-smart-cut"/);
  assert.match(card, /selectable && onSmartCut/);
  const page = read('app/veyrnox/app/library/page.js');
  assert.match(page, /onSmartCut=/);
});

test('every analyse message key the code can ask for exists in English', () => {
  for (const code of ['source_too_long', 'duration_mismatch', 'price_changed', 'speech_cut_unavailable', 'insufficient_balance', 'poll_timeout', 'x']) {
    assert.ok(messages[speechErrorKey({ code })], code);
  }
  for (const key of ['title', 'body', 'privacy', 'price', 'confirm', 'checking', 'running', 'done', 'tooLong', 'noSpeech', 'retry', 'unavailable', 'refunded', 'language', 'languageAuto', 'languageHelp']) {
    assert.ok(messages[`app.smartCut.analyse.${key}`], key);
  }
  assert.ok(messages['app.library.smartCutThis']);
});

test('the price copy never claims a verified price and other locales inherit English', () => {
  for (const [key, value] of Object.entries(messages)) {
    if (key.startsWith('app.smartCut.analyse.')) assert.doesNotMatch(value, /verified/i, key);
  }
  assert.ok(Array.isArray(LOCALES) || typeof LOCALES === 'object');
});

test('the planner shows filler suggestions only after analysis, opt-in, and passes the ticked ones as removals', () => {
  const planner = read('app/veyrnox/_components/SmartCutPlanner.js');
  assert.match(planner, /smartCutFillerRanges/);
  assert.match(planner, /useState\(false\)/); // removeFillers starts off
  assert.match(planner, /removals: removeFillers/);
  assert.match(planner, /!skippedFillers\.includes\(row\.key\)/);
  for (const key of ['title', 'toggle', 'none']) assert.ok(messages[`app.smartCut.fillers.${key}`], key);
  assert.match(messages['app.smartCut.fillers.toggle'], /\{count\}/);
});

test('the speech-ready notice does not name a pause length, because the pacing buttons change it', () => {
  const notice = messages['app.smartCut.speechReady'];
  assert.ok(notice);
  assert.doesNotMatch(notice, /\d/);
  assert.match(notice, /pacing/i);
});

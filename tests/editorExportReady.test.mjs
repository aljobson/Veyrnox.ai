import test from 'node:test';
import assert from 'node:assert/strict';
import { appMessagesFor } from '../lib/i18n/appMessages.mjs';
import { LOCALES } from '../lib/i18n/locales.mjs';
import { renderScenario } from './helpers/appI18nRound6.mjs';

const noop = () => {};
const tl = { fps: 30, aspect: '16:9', width: 1920, height: 1080, media: {}, video: [], audio: [], text: [], tracks: [], markers: [] };
const base = { tl, name: 'Cut', onName: noop, height: 1080, onHeight: noop };
const scenario = props => ({ area: 'export', name: 'ExportPanel', props: { ...base, ...props } });

test('a finished export shows the Ready to share card with preview, download, where it lives and Done', async () => {
  const html = renderScenario(scenario({ result: { url: 'blob:test', name: 'Cut.mp4' }, onDone: noop }), 'en', await appMessagesFor('en'));
  assert.match(html, /Ready to share/);
  assert.match(html, /<video[^>]*src="blob:test"/);
  assert.match(html, /download="Cut\.mp4"[^>]*>Download Cut\.mp4</);
  assert.match(html, /only on this device for now/);
  assert.match(html, />Done</);
});

test('a MOV export has no inline preview (browsers cannot play it) but keeps the download', async () => {
  const html = renderScenario(scenario({ result: { url: 'blob:test', name: 'Cut.mov' }, onDone: noop }), 'en', await appMessagesFor('en'));
  assert.doesNotMatch(html, /<video/);
  assert.match(html, /Download Cut\.mov/);
});

test('no Ready card while exporting; progress shows a percentage and the keep-open line', async () => {
  const html = renderScenario(scenario({ exporting: true, progress: 0.42, result: null }), 'en', await appMessagesFor('en'));
  assert.doesNotMatch(html, /Ready to share/);
  assert.match(html, /42%/);
  assert.match(html, /keep this tab open/);
  assert.match(html, /Cancel export/);
});

test('without onDone the card renders no Done button', async () => {
  const html = renderScenario(scenario({ result: { url: 'blob:test', name: 'Cut.mp4' } }), 'en', await appMessagesFor('en'));
  assert.doesNotMatch(html, />Done</);
});

test('every locale carries the five Ready to share keys', async () => {
  for (const locale of LOCALES.map(l => l.code ?? l)) {
    const m = await appMessagesFor(locale);
    for (const k of ['readyTitle', 'previewLabel', 'savedWhere', 'done', 'keepOpen']) assert.ok(m[`app.editor.export.${k}`], `${locale} ${k}`);
  }
});

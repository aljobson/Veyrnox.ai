import { englishBeatImports } from './helpers/musicBeatI18n.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { make } from './musicBeatFixtures.mjs';
import * as magic from '../app/veyrnox/_lib/music/beat/magicBar.mjs';
import { harness, find } from './helpers/musicBeatComponentHarness.mjs';
import { createGenerationClaimer } from '../app/veyrnox/_lib/generationClaim.mjs';
import { createGenerationQueue } from '../app/veyrnox/_lib/generationQueue.mjs';

const require = createRequire(import.meta.url);
const source = readFileSync(new URL('../app/veyrnox/_components/music/beat/BeatMagicBar.jsx', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText;
const compiled = { exports: {} };
const stubs = { ...englishBeatImports,
  '../../../_lib/gateway': { gatewayFetch: () => assert.fail('render must not make a request') },
  '../../../_lib/useMusicCelebrations': { useMusicCelebrations: () => () => {} },
  '../../../_lib/useMusicAudioSrc': { MusicPrivateAudio: () => null },
  '../../../_lib/music/beat/magicBar.mjs': magic,
  './beatStyles': { action: '', button: '', input: '' },
};
new Function('require', 'module', 'exports', code)(id => stubs[id] || require(id), compiled, compiled.exports);
const BeatMagicBar = compiled.exports.default;

test('AI generation hides the rendered legacy prompt form and keeps existing loop controls', () => {
  const loops = { layers: [{ songId: 'song', title: 'Existing keys', bars: 4, muted: false }], toggleMute() {}, remove() {} };
  const render = ai => renderToStaticMarkup(createElement(BeatMagicBar, { doc: make(), loops, announce() {}, hidePrompt: ai.generate }));
  assert.match(render({ generate: false }), /<form[ >]/);
  const html = render({ generate: true });
  assert.doesNotMatch(html, /<form[ >]|<textarea[ >]/);
  assert.match(html, /Existing keys/); assert.match(html, />Mute<\/button>/); assert.match(html, />Remove<\/button>/);
});

for (const [state, idempotent, expected] of [['partial', false, ['ready']], ['succeeded', false, ['ready-2', 'ready']], ['partial', true, []], ['refunded', false, []], ['failed', false, []]]) {
  test(`Magic Bar claims only fresh successful candidates (${state}, replay ${idempotent})`, async () => {
    const h = harness(), successes = [], amounts = [], notices = [], claim = createGenerationClaimer();
    const celebration = h.load('../../../_lib/useMusicCelebrations', {
      '../../lib/authClient': { getSession: () => ({ user: { id: 'A' } }) },
      './resultPresence': { useResultPresence() {} },
      './jobHistory': { settleGenerationResult: async (entry, owner) => {
        const won = await claim({ owner, id: entry.job_id, submittedAt: entry.submitted_at, currentOwner: () => 'A', settle: () => true });
        if (won) { successes.push(entry.job_id); amounts.push(entry.credits); }
      } },
    }, 'js');
    const candidates = [...(state === 'succeeded' ? [{ job_id: 'ready-2', state: 'ready' }] : []), { job_id: 'ready', state: 'ready' }, { job_id: 'failed', state: 'failed' }, { job_id: 'refunded', state: 'ready', refunded: true }];
    const Bar = h.load('BeatMagicBar', {
      '../../../_lib/useMusicCelebrations': celebration,
      '../../../_lib/music/beat/magicBar.mjs': { ...magic, startExampleRotation: () => () => {} },
      '../../../_lib/useMusicAudioSrc': { MusicPrivateAudio: () => null },
      '../../../_lib/gateway': { gatewayFetch: async path => {
        if (path === '/music/generation-quotes') return { quote_id: 'q', affordable: true, total_credits: 4 };
        if (path === '/music/generations') return { generation_id: 'g', state, candidates, idempotent };
        assert.equal(path, '/music/generations/g'); return { id: 'g', state, candidates };
      } },
    }).default;
    try {
      h.render(() => Bar({ doc: make(), loops: { layers: [] }, announce: text => notices.push(text) })); await h.settle();
      find(h.tree, node => node.type === 'input').props.onChange({ target: { value: 'Warm piano' } }); await h.settle();
      await find(h.tree, node => node.type === 'form').props.onSubmit({ preventDefault() {} }); await h.settle();
      await find(h.tree, node => node.type === 'button' && node.props.onClick?.name === 'confirm').props.onClick(); await h.settle();
      h.render(); await h.settle();
      assert.deepEqual(successes, expected);
      if (expected.length === 2) assert.deepEqual(amounts, [4, undefined], 'the actual Magic Bar forwards one server total for two loops');
      if (expected.length) assert.equal(notices.length, 1, 'only the submission cost uses the local announcer');
    } finally { h.close(); }
  });
}

test('music polling submits each candidate to the shared claim once despite new array identities', async () => {
  const h = harness(), calls = [];
  const { useMusicCelebrations } = h.load('../../../_lib/useMusicCelebrations', {
    '../../lib/authClient': { getSession: () => ({ user: { id: 'A' } }) },
    './resultPresence': { useResultPresence() {} },
    './jobHistory': { settleGenerationResult: (entry, owner) => { calls.push({ ...entry, owner }); return Promise.resolve(); } },
  }, 'js');
  let register, secondState = 'running', title = 'First title';
  const Probe = () => {
    register = useMusicCelebrations([{ id: 'g', state: 'partial', title,
      candidates: [{ job_id: 'one', state: 'ready' }, { job_id: 'two', state: secondState }] }]);
  };
  try {
    h.render(Probe);
    register({ generation_id: 'g' }, 3);
    await h.settle();
    assert.deepEqual(calls.map(entry => entry.job_id), ['one']);
    for (let poll = 0; poll < 5; poll++) { h.render(); await h.settle(); }
    assert.equal(calls.length, 1, 'no shared claim/storage/lock calls for identical polling results');
    title = 'Changed title'; h.render(); await h.settle();
    assert.equal(calls.length, 1, 'the per-hook Set also protects changed result metadata');
    secondState = 'ready'; h.render(); await h.settle();
    assert.deepEqual(calls.map(entry => entry.job_id), ['one', 'two']);
    h.render(); await h.settle();
    assert.equal(calls.length, 2);
  } finally { h.close(); }
});

test('two ready loops offer the server generation spend once, including a coalesced burst', async () => {
  const h = harness(), claimed = [], shown = [], timers = [];
  const queue = createGenerationQueue({ show: value => shown.push(value), isPresent: () => true, schedule: fn => { timers.push(fn); return timers.length; }, cancel() {} });
  const { useMusicCelebrations } = h.load('../../../_lib/useMusicCelebrations', {
    '../../lib/authClient': { getSession: () => ({ user: { id: 'A' } }) },
    './resultPresence': { useResultPresence() {} },
    './jobHistory': { settleGenerationResult: async entry => { claimed.push(entry); queue.push(entry); } },
  }, 'js');
  let register;
  const Probe = () => { register = useMusicCelebrations([{ id: 'g', state: 'succeeded', candidates: [
    { id: 'loop-1', state: 'ready', credits: 5 }, { id: 'loop-2', state: 'ready', credits: 5 },
  ] }]); };
  try {
    queue.push({ job_id: 'visible' });
    h.render(Probe); register({ generation_id: 'g' }, 5); await h.settle();
    assert.deepEqual(claimed.map(entry => entry.credits), [5, undefined]);
    assert.equal(claimed.reduce((sum, entry) => sum + (entry.credits || 0), 0), 5);
    queue.push({ job_id: 'another-1' }); queue.push({ job_id: 'another-2' });
    timers[0]();
    assert.equal(shown.at(-1).count, 4);
    assert.equal(shown.at(-1).credits, null, 'unpriced members omit the coalesced figure rather than multiply the quote');
    h.render(); await h.settle(); assert.equal(claimed.length, 2);
    assert.match(source, /registerCelebration\(accepted, quote\.total_credits\)/);
    for (const name of ['MusicAddSectionDialog.jsx', 'MusicCoverDialog.jsx', 'MusicExtendDialog.jsx', 'MusicRemixDialog.jsx', 'MusicReplaceSectionDialog.jsx', 'MusicStemDialog.jsx', 'MusicTargetStemDialog.jsx', 'MusicTrackAddDialog.jsx', 'useMusicServerState.js']) {
      const caller = readFileSync(new URL(`../app/veyrnox/_components/music/${name}`, import.meta.url), 'utf8');
      assert.match(caller, /registerCelebration\((?:accepted|result), quote\.total_credits\)/, name);
    }
  } finally { queue.clear(); h.close(); }
});

test('screen-local music registration does not survive navigation or reload; Beat has the same explicit exclusion', async () => {
  const calls = [];
  const mount = generations => {
    const h = harness();
    const { useMusicCelebrations } = h.load('../../../_lib/useMusicCelebrations', {
      '../../lib/authClient': { getSession: () => ({ user: { id: 'A' } }) },
      './resultPresence': { useResultPresence() {} },
      './jobHistory': { settleGenerationResult: entry => calls.push(entry) },
    }, 'js');
    let register;
    const Probe = () => { register = useMusicCelebrations(generations); };
    h.render(Probe); return { h, register };
  };
  const initial = mount([{ id: 'away', state: 'running', candidates: [] }]);
  initial.register({ generation_id: 'away' }, 4); await initial.h.settle(); initial.h.close();
  for (const reason of ['navigation', 'full reload']) {
    const resumed = mount([{ id: 'away', state: 'succeeded', candidates: [{ id: 'result', state: 'ready' }] }]);
    await resumed.h.settle(); assert.deepEqual(calls, [], reason); resumed.h.close();
  }
  for (const file of ['_lib/useMusicCelebrations.js', '_components/music/beat/useBeatAiRequest.js']) {
    assert.match(readFileSync(new URL(`../app/veyrnox/${file}`, import.meta.url), 'utf8'), /navigate-away completion is excluded/);
  }
  const beat = readFileSync(new URL('../app/veyrnox/_components/music/beat/useBeatAiRequest.js', import.meta.url), 'utf8');
  assert.match(beat, /cancelled = true; clearTimeout\(timer\)/);
  assert.match(beat, /fresh\.current = null/);
});

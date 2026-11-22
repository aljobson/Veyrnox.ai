import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { renderToStaticMarkup } from 'react-dom/server';
import * as pricing from '../app/veyrnox/_lib/music/durationPrice.js';
import { createQuoteGate } from '../lib/quoteRevisionGate.js';

const require = createRequire(import.meta.url);
function load(name, imports = {}, suffix = '') {
  const source = readFileSync(new URL(`../app/veyrnox/_components/music/${name}`, import.meta.url), 'utf8');
  const code = ts.transpileModule(source + suffix, {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const loaded = { exports: {} };
  new Function('require', 'module', 'exports', code)(id => imports[id]
    ?? (id === 'react/jsx-runtime' ? require(id) : {}), loaded, loaded.exports);
  return loaded.exports;
}
const priceImport = { '../../_lib/music/durationPrice.js': pricing };
const sunoForm = load('musicSunoForm.js');
const { MusicDurationField } = load('MusicDurationField.jsx', priceImport);
function* elements(node) {
  if (Array.isArray(node)) { for (const child of node) yield* elements(child); }
  else if (node?.props) {
    yield node;
    if (node.type === MusicDurationField) yield* elements(MusicDurationField(node.props));
    else yield* elements(node.props.children);
  }
}
const all = node => [...elements(node)];
const text = node => Array.isArray(node) ? node.map(text).join('')
  : node?.props ? text(node.props.children) : typeof node === 'string' || typeof node === 'number' ? String(node) : '';

test('the price helper module computes no prices (catalog and SQL quote own them)', () => {
  assert.deepEqual(Object.keys(pricing).sort(), ['reconcileMusicDuration']);
});

test('duration reconciliation clamps both bounds and leaves an allowed duration unchanged', () => {
  assert.equal(pricing.reconcileMusicDuration(180, { min: 10, max: 60 }), 60);
  assert.equal(pricing.reconcileMusicDuration(45, { min: 10, max: 60 }), 45);
  assert.equal(pricing.reconcileMusicDuration(5, { min: 10, max: 180 }), 10);
});

for (const [id, ariaLabel] of [['music-duration', 'Song duration'], ['custom-music-duration', 'Custom song duration']]) {
  test(`${ariaLabel}: switch-off markup preserves the original label, output, slider and hint`, () => {
    const simple = id === 'music-duration';
    const className = simple ? 'block rounded-2xl border border-vx-border bg-vx-base px-4 py-3 text-sm font-bold text-vx-fg-body' : 'block text-sm font-bold text-vx-fg-body';
    const hint = simple ? '<span class="mt-2 block font-normal leading-5 text-vx-fg-muted">The quoted candidate price covers any selected length from 10 to 60 seconds.</span>' : '';
    assert.equal(renderToStaticMarkup(MusicDurationField({ id, ariaLabel, value: 60, onChange() {} })),
      `<label class="${className}"><span class="flex items-center justify-between gap-3"><span>Song duration</span><output for="${id}" class="font-vx-mono text-xs text-vx-accent">60 seconds</output></span><input id="${id}" aria-label="${ariaLabel}" type="range" min="10" max="60" step="5" class="mt-3 w-full accent-vx-accent" value="60"/>${hint}</label>`);
  });
}

test('long-song hints describe 60-second price steps without numbers, and warn only above 60 seconds', () => {
  const props = { id: 'music-duration', ariaLabel: 'Song duration', bounds: { min: 10, max: 180 }, blockSeconds: 60 };
  const long = text(MusicDurationField({ ...props, value: 180 }));
  assert.match(long, /The price grows with length in 60-second steps\. Review the quote to see the exact price before any credits move\./);
  assert.match(long, /Longer songs take longer to generate\./);
  assert.doesNotMatch(long, /credits per version|Estimate|about \d/);
  assert.doesNotMatch(text(MusicDurationField({ ...props, value: 60 })), /Longer songs/);
  assert.doesNotMatch(text(MusicDurationField({ ...props, value: 60, bounds: { max: 60 }, blockSeconds: undefined })), /60-second steps|Longer songs/);
});

// Use the repository's transpiled-component/hook harness pattern, with actual
// form handlers and effects; unrelated child components and network calls are stubbed.
function formHarness(mode) {
  let cursor = 0, dirty = false, effects = [], clears = 0;
  const slots = [], requests = [], gate = createQuoteGate();
  const memo = (make, deps) => {
    const i = cursor++, old = slots[i];
    if (!old || deps.some((d, n) => !Object.is(d, old.deps[n]))) slots[i] = { deps, value: make() };
    return slots[i].value;
  };
  const hooks = {
    useState(initial) {
      const i = cursor++;
      if (!(i in slots)) {
        const slot = { value: typeof initial === 'function' ? initial() : initial };
        slot.set = next => {
          next = typeof next === 'function' ? next(slot.value) : next;
          if (!Object.is(next, slot.value)) { slot.value = next; dirty = true; }
        };
        slots[i] = slot;
      }
      return [slots[i].value, slots[i].set];
    },
    useMemo: memo,
    useRef: value => memo(() => ({ current: value }), []),
    useEffect: (effect, deps) => memo(() => { effects.push(effect); }, deps),
  };
  const { useMusicDuration } = load('useMusicDuration.js', { ...priceImport, react: hooks });
  const model = (id, max = 180) => ({ id, name: id, available: true, generation_modes: ['simple', 'custom'], credits_per_candidate: 3,
    controls: { duration_seconds: { min: 10, max, default: 60 }, ...(max > 60 ? { duration_price_block_seconds: 60 } : {}) } });
  const server = {
    entitlements: { available: true, balance: 100, models: [model('ace-step-1.5'), model('ace-step', 60)] },
    generations: [], quote: null, busy: '',
    clearQuote() { clears++; server.quote = null; gate.invalidate(); },
    quoteRevisionNow: () => gate.current(),
    async reviewQuote(request, startedAt) {
      if (startedAt !== undefined && !gate.unchanged(startedAt)) return;
      requests.push(request);
      server.quote = { mode, credits_per_candidate: 13, total_credits: 26, affordable: true, expires_at: new Date().toISOString() };
    },
  };
  const custom = { loaded: true, status: 'saved', draft: { model_id: 'ace-step-1.5', styles: 'Warm piano', lyrics: 'Original words', title: 'Draft', revision: 1 }, saveNow: async () => custom.draft };
  const compiled = load('MusicServerStudio.jsx', {
    react: hooks,
    './useMusicDuration': { useMusicDuration },
    './MusicDurationField': { MusicDurationField },
    './useMusicServerState': { useMusicServerState: () => server },
    './useMusicCustomDraft': { useMusicCustomDraft: () => custom },
    '../../../../lib/licensedTrackTemplates.js': { resolveInitialDescription: () => 'Warm piano' },
    '../../../lib/authClient': { getStoredUserId: () => null },
    './musicLyricHandoff': { readMusicLyricHandoff: () => null },
    './musicSunoForm': sunoForm,
  }, '\nexport { CustomDraftFields };');
  return {
    server, custom, gate, requests, get clears() { return clears; },
    render() {
      let tree, attempts = 0;
      do {
        assert.ok(++attempts < 10, 'effects settle'); cursor = 0; dirty = false; effects = [];
        tree = mode === 'simple' ? compiled.MusicServerStudio({})
          : compiled.CustomDraftFields({ ...server, custom, hasSharedSlot: true });
        for (const effect of effects) effect();
      } while (dirty);
      return tree;
    },
    refresh(max) { server.entitlements = { ...server.entitlements, models: [model('ace-step-1.5', max), model('ace-step', 60)] }; },
    slider(tree) { return all(tree).find(e => e.type === 'input' && e.props.type === 'range'); },
    async review(tree) {
      if (mode === 'simple') await all(tree).find(e => e.type === 'form').props.onSubmit({ preventDefault() {} });
      else await all(tree).find(e => e.type === 'button' && text(e) === 'Review Custom quote').props.onClick();
    },
  };
}

for (const mode of ['simple', 'custom']) {
  test(`${mode}: same-model entitlement refresh reconciles output, request and reviewed/in-flight quotes`, async t => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { search: '' }, setTimeout: () => 1, clearTimeout() {} } });
    t.after(() => { if (previous) Object.defineProperty(globalThis, 'window', previous); else delete globalThis.window; });
    const ui = formHarness(mode);
    let tree = ui.render();
    if (mode === 'simple') {
      all(tree).find(e => e.type === 'select').props.onChange({ target: { value: 'ace-step-1.5' } });
      tree = ui.render();
    }
    if (mode === 'custom') {
      all(tree).find(e => e.props['aria-label'] === 'Create an instrumental').props.onChange({ target: { checked: true } });
      tree = ui.render();
    }
    ui.slider(tree).props.onChange({ target: { value: '180', type: 'range' } });
    tree = ui.render();
    await ui.review(tree);
    assert.equal(ui.requests.at(-1).duration_seconds, 180);
    assert.match(text(ui.render()), /2 versions × 13 credits26 credits/); // The API quote is the only price shown.
    const pending = ui.gate.start(), clearsBefore = ui.clears;
    ui.refresh(60); tree = ui.render();
    assert.equal(ui.slider(tree).props.value, 60);
    assert.equal(ui.slider(tree).props.max, 60);
    assert.equal(text(all(tree).find(e => e.type === 'output')), '60 seconds');
    assert.equal(ui.server.quote, null);
    assert.equal(ui.clears, clearsBefore + 1);
    assert.equal(ui.gate.isCurrent(pending), false);
    tree = ui.render();
    assert.doesNotMatch(text(tree), /2 versions × 13 credits/);
    await ui.review(tree);
    assert.equal(ui.requests.at(-1).duration_seconds, 60);
    const quote = ui.server.quote;
    ui.refresh(60); ui.render();
    assert.equal(ui.server.quote, quote);
    assert.equal(ui.clears, clearsBefore + 1);
    ui.refresh(180); tree = ui.render();
    ui.slider(tree).props.onChange({ target: { value: '45', type: 'range' } });
    tree = ui.render(); await ui.review(tree);
    const allowedQuote = ui.server.quote, allowedClears = ui.clears;
    ui.refresh(60); tree = ui.render();
    assert.equal(ui.slider(tree).props.value, 45);
    assert.equal(ui.server.quote, allowedQuote);
    assert.equal(ui.clears, allowedClears);
    // Switching models also updates the effective bounds for either form.
    ui.refresh(180); tree = ui.render();
    ui.slider(tree).props.onChange({ target: { value: '180', type: 'range' } });
    tree = ui.render();
    if (mode === 'simple') all(tree).find(e => e.type === 'select').props.onChange({ target: { value: 'ace-step' } });
    else ui.custom.draft = { ...ui.custom.draft, model_id: 'ace-step' };
    tree = ui.render();
    assert.equal(ui.slider(tree).props.value, 60);
    await ui.review(tree);
    assert.equal(ui.requests.at(-1).duration_seconds, 60);
  });
}

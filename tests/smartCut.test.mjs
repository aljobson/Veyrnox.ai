import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { applySmartCutState, buildSmartCutPlan, commitSmartCutEditState, commitSmartCutGroupedEditState, endSmartCutEditGroupState, patchSmartCutMetadataState, redoSmartCutEditState, SMART_CUT_MAX_SEGMENTS, smartCutHasEdits, smartCutPlanUsesAvailableTakes, smartCutPlanWithinLimits, swapSmartCutTake, undoSmartCutEditState, undoSmartCutState } from '../app/veyrnox/_lib/smartCut.js';

const clips = [
  { job_id: 'take-a', name: 'Opening take', duration: 18 },
  { job_id: 'take-b', name: 'Cleaner take', duration: 20 },
];

test('Smart Cut creates a deterministic local plan from script sections', () => {
  const input = { clips, script: 'Open with the problem. Show the result! End with the invitation.', notes: 'Prefer a warm opening.', pacing: 'snappy' };
  const first = buildSmartCutPlan(input);
  const second = buildSmartCutPlan(input);
  assert.deepEqual(first, second);
  assert.equal(first.mode, 'local-demo');
  assert.equal(first.segments.length, 3);
  assert.deepEqual(first.segments.map((segment) => segment.takeId), ['take-a', 'take-b', 'take-a']);
  assert.ok(first.segments.every((segment) => segment.end > segment.start));
  assert.ok(first.warnings.some((warning) => /not analysed/i.test(warning)));
  assert.equal(first.notes, 'Prefer a warm opening.');
});

test('Smart Cut works without a script and warns when no alternate take exists', () => {
  const plan = buildSmartCutPlan({ clips: clips.slice(0, 1), pacing: 'relaxed' });
  assert.equal(plan.segments.length, 1);
  assert.equal(plan.pacingLabel, 'Relaxed');
  assert.ok(plan.warnings.some((warning) => /Only one take/i.test(warning)));
  assert.ok(plan.warnings.some((warning) => /No script/i.test(warning)));
});

test('alternate take swapping retains the section and clamps it to the new source', () => {
  const plan = buildSmartCutPlan({ clips, script: 'First section. Second section.', pacing: 'balanced' });
  const swapped = swapSmartCutTake(plan, 'section-1', 'take-b');
  assert.equal(swapped.segments[0].takeId, 'take-b');
  assert.equal(swapped.segments[1].takeId, plan.segments[1].takeId);
  assert.ok(swapped.segments[0].end <= 20);
  assert.deepEqual(plan.segments[0].takeId, 'take-a', 'the source plan is immutable');
});

test('fractional clip ends never round past the real media duration', () => {
  const plan = buildSmartCutPlan({ clips: [{ job_id: 'short', duration: 2.345 }], script: 'One two three four five six seven eight.' });
  assert.ok(plan.segments[0].end <= 2.345);
  assert.equal(plan.segments[0].end, 2.34);
});

test('replanning applied segments deduplicates repeated source takes', () => {
  const plan = buildSmartCutPlan({ clips: [clips[0], { ...clips[0], name: 'Duplicate row' }, clips[1]], script: 'First. Second.' });
  assert.deepEqual(plan.takes.map((take) => take.id), ['take-a', 'take-b'], 'identical library selections without row ids remain deduplicated');
});

test('replanning an applied cut keeps each editor row as a distinct source window', () => {
  const applied = [
    { ...clips[0], uid: 'take-a#smart-1', in_s: 1, out_s: 4 },
    { ...clips[0], uid: 'take-a#smart-2', in_s: 7, out_s: 10 },
  ];
  const plan = buildSmartCutPlan({ clips: applied, script: 'First. Second.' });
  assert.deepEqual(plan.takes.map((take) => take.id), ['take-a#smart-1', 'take-a#smart-2']);
  assert.deepEqual(plan.segments.map((segment) => segment.takeId), ['take-a#smart-1', 'take-a#smart-2']);
});

test('a stale plan cannot apply after one of its selected clips is removed', () => {
  const plan = buildSmartCutPlan({ clips, script: 'First. Second.' });
  assert.equal(smartCutPlanUsesAvailableTakes(plan, clips), true);
  assert.equal(smartCutPlanUsesAvailableTakes(plan, clips.slice(0, 1)), false);
});

test('a stale plan cannot apply after its source trim window changes', () => {
  const plan = buildSmartCutPlan({ clips, script: 'First. Second.' });
  assert.equal(smartCutPlanUsesAvailableTakes(plan, clips), true);
  assert.equal(smartCutPlanUsesAvailableTakes(plan, clips.map((item) => ({ ...item, in_s: 10, out_s: item.duration }))), false);
});

test('staleness checks the exact duplicate editor row used by a segment', () => {
  const applied = [
    { ...clips[0], uid: 'take-a#smart-1', in_s: 1, out_s: 4 },
    { ...clips[0], uid: 'take-a#smart-2', in_s: 7, out_s: 10 },
  ];
  const plan = buildSmartCutPlan({ clips: applied, script: 'First. Second.' });
  assert.equal(smartCutPlanUsesAvailableTakes(plan, applied), true);
  assert.equal(smartCutPlanUsesAvailableTakes(plan, [applied[0], { ...applied[1], in_s: 9.5 }]), false);
});

test('long scripts stop at the Clip Editor limit', () => {
  const script = Array.from({ length: 12 }, (_, index) => `Section ${index + 1} has enough words to use relaxed pacing.`).join(' ');
  const plan = buildSmartCutPlan({ clips, script, pacing: 'relaxed' });
  assert.ok(plan.totalDuration <= 60);
  assert.ok(plan.segments.length <= SMART_CUT_MAX_SEGMENTS);
});

test('an exhausted take never reuses an overlapping source range', () => {
  const plan = buildSmartCutPlan({ clips: [{ job_id: 'short', duration: 5 }], script: 'First section. Second section. Third section. Fourth section.', pacing: 'snappy' });
  for (let index = 1; index < plan.segments.length; index += 1) assert.ok(plan.segments[index].start >= plan.segments[index - 1].end);
});

test('take swapping re-times every section without overlapping the same source', () => {
  const plan = buildSmartCutPlan({ clips, script: 'First. Second. Third.' });
  const swapped = swapSmartCutTake(plan, 'section-2', 'take-a');
  const fromA = swapped.segments.filter((segment) => segment.takeId === 'take-a');
  for (let index = 1; index < fromA.length; index += 1) assert.ok(fromA[index].start >= fromA[index - 1].end);
});

test('take swapping refuses an alternate that would exceed sixty seconds', () => {
  const longScript = Array.from({ length: 10 }, (_, index) => `Section ${index + 1} ${Array.from({ length: 18 }, () => 'word').join(' ')}.`).join(' ');
  const sources = [{ job_id: 'short', duration: 1.5 }, { job_id: 'long', duration: 70 }];
  const plan = buildSmartCutPlan({ clips: sources, script: longScript, pacing: 'relaxed' });
  const swapped = swapSmartCutTake(plan, 'section-1', 'long');
  assert.deepEqual(swapped.segments, plan.segments);
  assert.ok(swapped.warnings.some((warning) => /Clip Editor limits/i.test(warning)));
  assert.equal(smartCutPlanWithinLimits(swapped), true);
});

test('the final apply guard rejects plans over the renderer limits', () => {
  assert.equal(smartCutPlanWithinLimits({ segments: [{ start: 0, end: 60 }] }), true);
  assert.equal(smartCutPlanWithinLimits({ segments: [{ start: 0, end: 60.01 }] }), false);
  assert.equal(smartCutPlanWithinLimits({ segments: Array.from({ length: 11 }, () => ({ start: 0, end: 1 })) }), false);
});

test('planning respects existing source trim windows', () => {
  const plan = buildSmartCutPlan({ clips: [{ job_id: 'trimmed', duration: 20, in_s: 5, out_s: 9 }], script: 'Keep this range.' });
  assert.ok(plan.segments.every((segment) => segment.start >= 5 && segment.end <= 9));
});

test('fractional trim starts round inward instead of selecting earlier footage', () => {
  const plan = buildSmartCutPlan({ clips: [{ job_id: 'trimmed', duration: 5, in_s: 1.005, out_s: 2 }], script: 'Keep this range.' });
  assert.ok(plan.segments[0].start >= 1.005);
  assert.equal(plan.segments[0].start, 1.01);
});

test('speech-aware plans cannot be retimed onto an unanalysed alternate', () => {
  const plan = { ...buildSmartCutPlan({ clips, script: 'First.' }), mode: 'transcript-silence' };
  const swapped = swapSmartCutTake(plan, 'section-1', 'take-b');
  assert.equal(swapped.segments[0].takeId, plan.segments[0].takeId);
  assert.ok(swapped.warnings.some((warning) => /analysed source take/i.test(warning)));
});

test('Smart Cut undo restores the original list after later fine-tuning', () => {
  const original = [{ uid: 'a', in_s: 0, out_s: 8 }];
  const applied = [{ uid: 'a#smart', in_s: 1, out_s: 4 }];
  const state = applySmartCutState({ items: original, smartCutSnapshot: null }, applied);
  const fineTuned = { ...state, items: [{ ...state.items[0], in_s: 1.5 }] };
  assert.equal(smartCutHasEdits(state.items, state.smartCutApplied), false);
  assert.equal(smartCutHasEdits(fineTuned.items, fineTuned.smartCutApplied), true);
  assert.deepEqual(undoSmartCutState(fineTuned), { items: original, smartCutSnapshot: null, smartCutApplied: null, editPast: [], editFuture: [], editGroup: null });
});

test('manual editor undo and redo restore ordered clip states', () => {
  const original = [{ uid: 'a', in_s: 0, out_s: 4 }, { uid: 'b', in_s: 0, out_s: 5 }];
  const trimmed = [{ ...original[0], in_s: 1 }, original[1]];
  const reordered = [trimmed[1], trimmed[0]];
  const initial = { items: original, editPast: [], editFuture: [] };
  const edited = commitSmartCutEditState(commitSmartCutEditState(initial, trimmed), reordered);
  const once = undoSmartCutEditState(edited);
  assert.deepEqual(once.items, trimmed);
  const twice = undoSmartCutEditState(once);
  assert.deepEqual(twice.items, original);
  const redone = redoSmartCutEditState(twice);
  assert.deepEqual(redone.items, trimmed);
  assert.deepEqual(redoSmartCutEditState(redone).items, reordered);
});

test('Undo Smart Cut clears manual history so it cannot restore an orphaned applied cut', () => {
  const original = [{ uid: 'original', in_s: 0, out_s: 8 }];
  const applied = [{ uid: 'applied', in_s: 1, out_s: 5 }];
  const state = commitSmartCutEditState(
    { ...applySmartCutState({ items: original, smartCutSnapshot: null, smartCutApplied: null }, applied), editPast: [], editFuture: [] },
    [{ ...applied[0], in_s: 1.5 }],
  );
  const restored = undoSmartCutState(state);
  assert.deepEqual(restored.items, original);
  assert.deepEqual(restored.editPast, []);
  assert.deepEqual(restored.editFuture, []);
  assert.equal(undoSmartCutEditState(restored), restored);
});

test('loaded metadata is patched through manual history and Smart Cut snapshots', () => {
  const unloaded = { uid: 'a', job_id: 'take-a', duration: null, out_s: null, ratio: null };
  const state = {
    items: [unloaded],
    smartCutSnapshot: [unloaded],
    smartCutApplied: [unloaded],
    editPast: [[unloaded]],
    editFuture: [[unloaded]],
  };
  const patched = patchSmartCutMetadataState(state, 'a', { duration: 8, out_s: 8, ratio: '1.78' });
  for (const items of [patched.items, patched.smartCutSnapshot, patched.smartCutApplied, ...patched.editPast, ...patched.editFuture]) {
    assert.deepEqual(items[0], { ...unloaded, duration: 8, out_s: 8, ratio: '1.78' });
  }
});

test('reloaded metadata fills missing ends without overwriting trims in saved states', () => {
  const state = {
    items: [{ uid: 'a', duration: 10, out_s: 3, ratio: null }],
    smartCutSnapshot: [{ uid: 'a', duration: null, out_s: null, ratio: null }],
    smartCutApplied: [{ uid: 'a', duration: 10, out_s: 4, ratio: null }],
    editPast: [[{ uid: 'a', duration: 10, out_s: 8, ratio: null }]],
    editFuture: [[{ uid: 'a', duration: 10, out_s: 6, ratio: null }]],
  };
  const patched = patchSmartCutMetadataState(state, 'a', { duration: 12, out_s: 3, ratio: '1.78' });
  assert.equal(patched.items[0].out_s, 3);
  assert.equal(patched.smartCutApplied[0].out_s, 4);
  assert.equal(patched.editPast[0][0].out_s, 8);
  assert.equal(patched.editFuture[0][0].out_s, 6);
  assert.equal(patched.smartCutSnapshot[0].out_s, 12);
  assert.ok([patched.items, patched.smartCutApplied, patched.smartCutSnapshot, ...patched.editPast, ...patched.editFuture].every((items) => items[0].duration === 12 && items[0].ratio === '1.78'));
});

test('manual edit history is bounded and a new edit clears redo', () => {
  let state = { items: [{ uid: 'a', in_s: 0 }], editPast: [], editFuture: [[{ uid: 'future' }]] };
  for (let index = 1; index <= 35; index += 1) state = commitSmartCutEditState(state, [{ uid: 'a', in_s: index }]);
  assert.equal(state.editPast.length, 30);
  assert.deepEqual(state.editFuture, []);
});

test('one focused trim edit is one undo entry and undo ends its group', () => {
  const original = [{ uid: 'a', in_s: 0, out_s: 8 }];
  const group = 'a:in_s';
  let state = { items: original, editPast: [], editFuture: [], editGroup: null };
  state = commitSmartCutGroupedEditState(state, [{ ...original[0], in_s: 1 }], group);
  state = commitSmartCutGroupedEditState(state, [{ ...original[0], in_s: 1.5 }], group);
  assert.equal(state.editPast.length, 1);
  assert.equal(state.editGroup, group);
  state = undoSmartCutEditState(state);
  assert.deepEqual(state.items, original);
  assert.equal(state.editGroup, null);
  state = commitSmartCutGroupedEditState(state, [{ ...original[0], in_s: 2 }], group);
  assert.equal(state.editPast.length, 1);
  assert.deepEqual(state.editFuture, []);
  assert.deepEqual(undoSmartCutEditState(endSmartCutEditGroupState(state)).items, original);
});

test('the existing Clip Editor owns Smart Cut apply and the caption/export handoff', () => {
  const editor = readFileSync(new URL('../app/veyrnox/_components/EditSheet.js', import.meta.url), 'utf8');
  const planner = readFileSync(new URL('../app/veyrnox/_components/SmartCutPlanner.js', import.meta.url), 'utf8');
  const messages = readFileSync(new URL('../lib/i18n/messages/app/en/smart-cut.mjs', import.meta.url), 'utf8');
  assert.match(editor, /<SmartCutWorkbench/);
  assert.match(editor, /<SmartCutPlanner[\s\S]*clips=\{items\}[\s\S]*applyRevision=\{smartCutApplyRevision\}[\s\S]*onApply=\{applySmartCut\}[\s\S]*startOpen[\s\S]*\/>/);
  assert.match(planner, /app\.smartCut\.action\.apply/);
  assert.match(planner, /app\.smartCut\.action\.undo/);
  assert.match(planner, /app\.smartCut\.why/);
  assert.match(messages, /Apply to Clip Editor/);
  assert.match(messages, /Undo Smart Cut/);
  assert.match(messages, /Why this take:/);
  assert.match(planner, /SmartCutSegmentPreview/);
  assert.match(messages, /no analysis upload, external AI call or credit spend/i);
  assert.match(planner, /buildSpeechAwareCutPlan/);
  assert.match(planner, /smartCutPlanWithinLimits/);
  assert.match(editor, /applySmartCutState/);
  assert.match(editor, /undoSmartCutState/);
  assert.match(editor, /pendingSmartCutApply/);
  assert.match(editor, /app\.smartCut\.price\.review/);
  assert.match(editor, /app\.smartCut\.price\.title/);
  assert.match(editor, /Object\.entries\(patch\)\.every/);
  assert.match(editor, /commitSmartCutGroupedEditState\(state, nextItems, group\)/);
  assert.match(editor, /onBlur=\{onEditEnd\}/);
  assert.match(editor, /confirmCreate && \(cost == null \|\| blocked\)/);
  assert.match(editor, /\{\(showCaptions \|\| smartCut\) && <div id=\{smartCut \? 'clip-text-controls' : undefined\}/);
  assert.match(editor, /\{smartCut && <div id="smart-cut-panel"/);
  assert.doesNotMatch(planner, /ConfirmDialog/);
  assert.match(editor, /app\.editor\.sheet\.captions/);
  assert.match(editor, /app\.editor\.sheet\.create/);
});

test('Smart Cut workbench exposes playback, timeline tools and accessible zoom', () => {
  const workbench = readFileSync(new URL('../app/veyrnox/_components/SmartCutWorkbench.js', import.meta.url), 'utf8');
  const messages = readFileSync(new URL('../lib/i18n/messages/app/en/smart-cut.mjs', import.meta.url), 'utf8');
  assert.match(workbench, /previewRef\.current\?\.pause\(\)/);
  assert.match(workbench, /app\.smartCut\.workbench\.zoomGroup/);
  assert.match(workbench, /app\.smartCut\.workbench\.zoomOut/);
  assert.match(workbench, /app\.smartCut\.workbench\.zoomIn/);
  assert.match(workbench, /clipOutputDuration/);
  assert.match(workbench, /items\.findIndex\(\(item\) => item\.uid === activeSelection\.uid\)/);
  assert.match(workbench, /matchedIndex >= 0 \? matchedIndex : clampIndex\(activeSelection\.index, items\.length\)/);
  assert.match(workbench, /!event\.currentTarget\.paused && current >= end/);
  assert.match(workbench, /\[start\]/);
  assert.match(workbench, /previewRef\.current\.playbackRate = playbackRate/);
  assert.match(workbench, /role="region"[\s\S]*thumbnailTimeline/);
  assert.match(workbench, /aria-current=\{activeTool === tool \? 'location' : undefined\}/);
  for (const label of ['Portrait edit preview', 'Clip timeline', 'Smart Cut editing tools', 'Undo manual edit', 'Redo manual edit']) assert.match(messages, new RegExp(label));
});

test('Smart Cut has a mobile-first path from home to a review-ready editor', () => {
  const home = readFileSync(new URL('../app/veyrnox/app/page.js', import.meta.url), 'utf8');
  const entry = readFileSync(new URL('../app/veyrnox/_components/SmartCutEntry.js', import.meta.url), 'utf8');
  const library = readFileSync(new URL('../app/veyrnox/app/library/page.js', import.meta.url), 'utf8');
  const intent = readFileSync(new URL('../app/veyrnox/_lib/useSmartCutIntent.js', import.meta.url), 'utf8');
  const messages = readFileSync(new URL('../lib/i18n/messages/app/en/smart-cut.mjs', import.meta.url), 'utf8');
  assert.match(home, /\/app\/library#smart-cut/);
  assert.match(home, /app\.explore\.smartCutStart/);
  assert.match(entry, /app\.smartCut\.entry\.enable/);
  assert.match(messages, /Turn finished clips into a reviewed first cut/);
  assert.match(messages, /Enable Smart Cut preview/);
  assert.match(messages, /Planning is local and free/);
  assert.match(intent, /window\.location\.hash === '#smart-cut'/);
  assert.match(library, /smartCut=\{smartCutIntent\}/);
  assert.match(library, /bottom-\[calc\(4\.5rem\+env\(safe-area-inset-bottom,0px\)\)\]/);
});

test('Smart Cut leads the Library page, ahead of the title, filters and every asset list', () => {
  const library = readFileSync(new URL('../app/veyrnox/app/library/page.js', import.meta.url), 'utf8');
  const entry = readFileSync(new URL('../app/veyrnox/_components/SmartCutEntry.js', import.meta.url), 'utf8');
  const smartCut = library.indexOf('<SmartCutEntry');
  assert.ok(smartCut > 0);
  for (const later of ['data-testid="library-title"', '<DeviceLibrary', '<EditorLibraryRenders', '<FilmLibraryMasters', 'id="library-assets"']) {
    assert.ok(smartCut < library.indexOf(later), `Smart Cut renders before ${later}`);
  }
  assert.match(library, /smartCutIntent\s+\? <h2 data-testid="library-title"[^\n]+\n\s+: <h1 data-testid="library-title"/);
  assert.match(entry, /<h1 id="smart-cut-entry-title"/);
});

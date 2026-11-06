import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { applySmartCutState, buildSmartCutPlan, SMART_CUT_MAX_SEGMENTS, smartCutPlanUsesAvailableTakes, smartCutPlanWithinLimits, swapSmartCutTake, undoSmartCutState } from '../app/veyrnox/_lib/smartCut.js';

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
  assert.deepEqual(undoSmartCutState(fineTuned), { items: original, smartCutSnapshot: null });
});

test('the existing Clip Editor owns Smart Cut apply and the caption/export handoff', () => {
  const editor = readFileSync(new URL('../app/veyrnox/_components/EditSheet.js', import.meta.url), 'utf8');
  const planner = readFileSync(new URL('../app/veyrnox/_components/SmartCutPlanner.js', import.meta.url), 'utf8');
  assert.match(editor, /<SmartCutPlanner[\s\S]*clips=\{items\}[\s\S]*onApply=\{applySmartCut\}[\s\S]*startOpen=\{smartCut\}[\s\S]*\/>/);
  assert.match(planner, /Apply to Clip Editor/);
  assert.match(planner, /Undo Smart Cut/);
  assert.match(planner, /Why this take:/);
  assert.match(planner, /SmartCutSegmentPreview/);
  assert.match(planner, /no analysis upload, external AI call or credit spend/i);
  assert.match(planner, /buildSpeechAwareCutPlan/);
  assert.match(planner, /smartCutPlanWithinLimits/);
  assert.match(editor, /applySmartCutState/);
  assert.match(editor, /undoSmartCutState/);
  assert.match(editor, /app\.editor\.sheet\.captions/);
  assert.match(editor, /app\.editor\.sheet\.create/);
});

test('Smart Cut has a mobile-first path from home to a review-ready editor', () => {
  const home = readFileSync(new URL('../app/veyrnox/app/page.js', import.meta.url), 'utf8');
  const entry = readFileSync(new URL('../app/veyrnox/_components/SmartCutEntry.js', import.meta.url), 'utf8');
  const library = readFileSync(new URL('../app/veyrnox/app/library/page.js', import.meta.url), 'utf8');
  assert.match(home, /\/app\/library#smart-cut/);
  assert.match(home, /Turn finished clips into a reviewed first cut/);
  assert.match(entry, /Enable Smart Cut preview/);
  assert.match(entry, /Planning is local and free/);
  assert.match(library, /window\.location\.hash === '#smart-cut'/);
  assert.match(library, /smartCut=\{smartCutIntent\}/);
  assert.match(library, /bottom-\[calc\(4\.5rem\+env\(safe-area-inset-bottom,0px\)\)\]/);
});

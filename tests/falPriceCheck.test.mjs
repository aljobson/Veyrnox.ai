import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
    DRIFT_MODES, MARGIN_FLOOR, checkRow, comparisonRate, creditsForFloor, extractPrices, failingCount, marginAt, rowLines,
} from '../scripts/lib/fal-price-check.mjs';
import { UNIT_RATES } from '../scripts/lib/fal-unit-rates.mjs';
import { REGISTRY } from '../lib/modelCapabilities.js';

// The pricing sentences fal's model pages carried on 2026-10-09, with the
// kind of noise that surrounds them: script references ("$21", "$2a") and
// the "For $1 you can run" line.
const NOISE = ' I[931823,["$21","$22","$2a","$undefined"]] ';
const ACE_PAGE = `<p>Your request will cost $0.0002 per second of generated audio. For $1 you can run generate 5000 seconds.</p>${NOISE}`;
const ACE_15_PAGE = `<p>Your request will cost $0.0003 per output second. Thinking-enabled requests run at 2×.</p>${NOISE}`;
const AVATAR_PAGE = `<meta content="Kling AI Avatar v2. $0.0562/second. Free preview."/> Pro Tier Cost $0.115/second. Kling 2.1 Master at $1.40 for 5 seconds ($0.28/additional second). Argil at $0.02/second.${NOISE}`;

const row = (over) => ({ id: 'row', provider: 'fal', credits_5s: 3, provider_cost_per_unit: 0.04, cost_unit: 'per_generation', billing_seconds: null, active: true, ...over });
const ACE = row({ id: 'ace-step', credits_5s: 1, provider_cost_per_unit: 0.012 });
const ACE_15 = row({ id: 'ace-step-1.5', credits_5s: 3, provider_cost_per_unit: 0.036 });
const AVATAR = row({ id: 'kling-avatar-v2', credits_5s: 35, provider_cost_per_unit: 0.562 });
const check = (r, html, rates = UNIT_RATES) => checkRow(r, extractPrices(html), rates);

test('prices are read from the page; whole dollars and script references are not', () => {
    assert.deepEqual(extractPrices(ACE_PAGE), [0.0002]);
    assert.deepEqual(extractPrices(AVATAR_PAGE), [0.02, 0.0562, 0.115, 0.28, 1.4]);
    assert.deepEqual(extractPrices('$0 $0.00 $51.50 $15 $24 plans'), []);
    assert.deepEqual(extractPrices('**$0.01** per 1000 character, **$0.01** again'), [0.01]);
    assert.deepEqual(extractPrices('<p>no price here</p>'), []);
});

test('the margin sums are the ones the catalog is priced by', () => {
    // 34 Credits at $0.033 against $0.56: the Kling 3.0 row.
    assert.equal((marginAt(0.56, 34) * 100).toFixed(1), '50.1');
    assert.equal(marginAt(0.04, 0), -1);
    assert.equal(creditsForFloor(0.56), 34);
    assert.equal(creditsForFloor(0.01), 1);
    assert.equal(creditsForFloor(0.0166), 2);
    assert.equal(MARGIN_FLOOR, 0.5);
});

test('a unit-priced row whose page shows its rate is ok', () => {
    const r = check(ACE_15, ACE_15_PAGE);
    assert.equal(r.verdict, 'ok');
    assert.equal(r.cost, null);
    assert.deepEqual(rowLines(r), ['ok    ace-step-1.5         $0.0003 /s x 60 x 2    3cr  margin 63.6%']);
    assert.equal(check(AVATAR, AVATAR_PAGE).verdict, 'ok');
});

test('the same row is flagged when the rate on the page changes', () => {
    const raised = check(AVATAR, AVATAR_PAGE.replaceAll('$0.0562', '$0.0700'));
    assert.equal(raised.verdict, 'drift');
    assert.deepEqual(rowLines(raised), ['DRIFT? kling-avatar-v2      expect $0.0562 /s x 10  page: $0.02 $0.07 $0.115 $0.28 $1.4']);
});

// Half a tenth of a cent either way is the allowance a per-generation price
// gets. On a rate of $0.0002 it would cover a rise to $0.0007.
test('a sub-cent rate that doubles is flagged', () => {
    assert.equal(check(ACE, ACE_PAGE.replace('$0.0002', '$0.0004')).verdict, 'drift');
    assert.equal(check(ACE_15, ACE_15_PAGE.replace('$0.0003', '$0.0004')).verdict, 'drift');
    assert.equal(check(ACE, ACE_PAGE).verdict, 'ok');
});

// The rate is copied from the page, so only that figure will do. Kling
// Avatar clears the floor by 2.8% of its cost: a 3% rise is a breach.
test('a listed rate has no tolerance', () => {
    assert.equal(check(AVATAR, AVATAR_PAGE.replaceAll('$0.0562', '$0.0579')).verdict, 'drift');
    assert.equal(check(AVATAR, AVATAR_PAGE.replaceAll('$0.0562', '$0.0561')).verdict, 'drift');
    assert.equal(check(row({ id: 'inworld-tts', credits_5s: 2, provider_cost_per_unit: 0.02 }), '**$0.0105** per 1000 character').verdict, 'drift');
});

test('a unit-priced row whose page shows no price at all is flagged, not passed', () => {
    const r = check(ACE_15, '<p>Pricing has moved.</p>');
    assert.equal(r.verdict, 'drift');
    assert.deepEqual(rowLines(r), ['DRIFT? ace-step-1.5         expect $0.0003 /s x 60 x 2  page: no price']);
});

test('a recorded cost that is not rate x quantity is reported as its own line', () => {
    const r = check({ ...ACE, provider_cost_per_unit: 0.01 }, ACE_PAGE);
    assert.equal(r.verdict, 'ok');
    assert.equal(r.cost.built.toFixed(4), '0.0120');
    assert.deepEqual(rowLines(r), ['COST?  ace-step             records $0.0100, $0.0002 /s x 60 = $0.0120  1cr  margin 63.6% at that cost']);
});

test('a recorded cost under what the rate comes to says so when that is under the floor', () => {
    // fal's rate was raised in the table and the catalog row was not followed.
    const rates = { 'kling-avatar-v2': { rate: 0.07, per: 's', quantity: 10 } };
    const r = check(AVATAR, AVATAR_PAGE.replaceAll('$0.0562', '$0.07'), rates);
    assert.equal(r.verdict, 'ok');
    assert.ok(r.cost.margin < MARGIN_FLOOR);
    assert.deepEqual(rowLines(r), ['COST?  kling-avatar-v2      records $0.5620, $0.0700 /s x 10 = $0.7000  35cr  margin 39.4% at that cost < 50%']);
});

test('a row under the floor at the rate is reported even when its recorded cost is close', () => {
    // 4% apart, inside what the recorded cost is allowed, and across the floor.
    const rates = { 'kling-avatar-v2': { rate: 0.0585, per: 's', quantity: 10 } };
    const r = check(AVATAR, AVATAR_PAGE.replaceAll('$0.0562', '$0.0585'), rates);
    assert.equal(r.verdict, 'ok');
    assert.ok(r.margin >= MARGIN_FLOOR && r.cost.margin < MARGIN_FLOOR);
    assert.deepEqual(rowLines(r), ['COST?  kling-avatar-v2      records $0.5620, $0.0585 /s x 10 = $0.5850  35cr  margin 49.4% at that cost < 50%']);
    // As close, and still over the floor: nothing to report.
    const near = check(AVATAR, AVATAR_PAGE.replaceAll('$0.0562', '$0.057'), { 'kling-avatar-v2': { rate: 0.057, per: 's', quantity: 10 } });
    assert.equal(near.cost, null);
    assert.deepEqual(rowLines(near), ['ok    kling-avatar-v2      $0.0570 /s x 10        35cr  margin 51.3%']);
});

test('a moved rate and a wrong recorded cost are both reported', () => {
    const r = check({ ...ACE, provider_cost_per_unit: 0.01 }, ACE_PAGE.replace('$0.0002', '$0.0004'));
    assert.deepEqual(rowLines(r).map((l) => l.slice(0, 6)), ['DRIFT?', 'COST? ']);
});

test('a per_second row is matched on its rate, as before', () => {
    const kling = row({ id: 'kling-3.0-i2v', credits_5s: 34, provider_cost_per_unit: 0.56, cost_unit: 'per_second', billing_seconds: 5 });
    assert.deepEqual(comparisonRate(kling), { rate: 0.56 / 5, unit: '/s x 5s', total: 0.56 });
    const ok = check(kling, 'you will be charged **$0.112** (audio off) or **$0.168** (audio on)');
    assert.deepEqual(rowLines(ok), ['ok    kling-3.0-i2v        $0.1120 /s x 5s        34cr  margin 50.1%']);
    const moved = check(kling, 'you will be charged **$0.14** (audio off) or **$0.168** (audio on)');
    assert.deepEqual(rowLines(moved), ['DRIFT? kling-3.0-i2v        expect $0.1120 /s x 5s  page: $0.14 $0.168']);
    // No billing_seconds means the five-second unit.
    assert.equal(comparisonRate({ ...kling, billing_seconds: null }).unit, '/s x 5s');
});

test('a plain per_generation row is matched on its cost, as before', () => {
    const bria = row({ id: 'bria-expand' });
    assert.deepEqual(comparisonRate(bria), { rate: 0.04, unit: 'per generation', total: 0.04 });
    assert.deepEqual(rowLines(check(bria, 'Your request will cost **$0.04** per image. $0.14')),
        ['ok    bria-expand          $0.0400 per generation 3cr  margin 59.6%']);
    assert.deepEqual(rowLines(check(bria, 'Your request will cost **$0.06** per image.')),
        ['DRIFT? bria-expand          expect $0.0400 per generation  page: $0.06']);
    // Within a twentieth, or half a tenth of a cent: fal rounds.
    assert.equal(check(bria, '$0.0419').verdict, 'ok');
    assert.equal(check(row({ provider_cost_per_unit: 0.008, credits_5s: 1 }), '$0.0084').verdict, 'ok');
    assert.equal(check(row({ provider_cost_per_unit: 0.008, credits_5s: 1 }), '$0.009').verdict, 'drift');
    // A page with no price on it cannot be compared and still passes.
    assert.equal(check(bria, '<p>no price here</p>').verdict, 'ok');
    assert.equal(check(bria, '<p>no price here</p>').cost, null);
});

test('a recorded cost under the floor is a breach, whatever the page shows', () => {
    const thin = row({ id: 'thin', credits_5s: 2, provider_cost_per_unit: 0.04 });
    for (const html of ['$0.04', '$0.09', '']) {
        assert.deepEqual(rowLines(check(thin, html)), ['BREACH thin                 margin 39.4% < 50%']);
    }
    assert.equal(check({ ...ACE_15, credits_5s: 2 }, ACE_15_PAGE).verdict, 'breach');
});

test('only a dead endpoint or a breach fails the run unless drift is switched on', () => {
    const none = { dead: 0, breach: 0, drift: 0, listedDrift: 0, underFloor: 0 };
    const noisy = { ...none, drift: 6 };
    const moved = { ...none, drift: 7, listedDrift: 1 };
    for (const mode of ['false', undefined, 'true']) {
        assert.equal(failingCount(none, mode), 0);
        assert.equal(failingCount({ ...moved, underFloor: 1 }, mode), 0);
        assert.equal(failingCount({ ...moved, dead: 1, breach: 2 }, mode), 3);
    }
    // 'listed': a stray figure on every fal page does not file an issue.
    assert.equal(failingCount(noisy, 'listed'), 0);
    assert.equal(failingCount(moved, 'listed'), 1);
    assert.equal(failingCount({ ...none, underFloor: 1 }, 'listed'), 1);
    assert.equal(failingCount(noisy, 'all'), 6);
    assert.equal(failingCount({ ...moved, underFloor: 1 }, 'all'), 8);
    assert.equal(failingCount(none, 'all'), 0);
    assert.deepEqual(DRIFT_MODES, ['false', 'listed', 'all']);
});

test('a checked row says whether its rate is a listed one', () => {
    assert.equal(check(ACE_15, ACE_15_PAGE).listed, true);
    assert.equal(check(row({ id: 'bria-expand' }), '$0.04').listed, false);
});

test('the workflow sets the switch to a value the script takes', () => {
    const set = readFileSync(new URL('../.github/workflows/fal-catalog-watch.yml', import.meta.url), 'utf8').match(/FAL_DRIFT_FAILS: '([a-z]+)'/);
    assert.ok(set && DRIFT_MODES.includes(set[1]), 'the workflow sets FAL_DRIFT_FAILS to a value the script does not take');
});

// A value it does not know stops the run before anything is fetched, instead
// of reading as off.
test('the script refuses a switch value it does not know', () => {
    const script = fileURLToPath(new URL('../scripts/check-fal-catalog.mjs', import.meta.url));
    for (const args of [[], ['--offline']]) {
        const run = spawnSync(process.execPath, [script, ...args], {
            env: { PATH: process.env.PATH, FAL_DRIFT_FAILS: 'true' }, encoding: 'utf8',
        });
        assert.equal(run.status, 1);
        assert.match(run.stderr, /FAL_DRIFT_FAILS is "true"; it takes false, listed, all/);
    }
});

const built = (id) => comparisonRate(row({ id }), UNIT_RATES).built.toFixed(4);

test('each listed rate comes to the cost of one generation', () => {
    assert.deepEqual(Object.keys(UNIT_RATES).sort(), ['ace-step', 'ace-step-1.5', 'inworld-tts', 'kling-avatar-v2', 'mmaudio-v2-video']);
    assert.equal(built('ace-step'), '0.0120');
    assert.equal(built('ace-step-1.5'), '0.0360');
    assert.equal(built('inworld-tts'), '0.0200');
    assert.equal(built('kling-avatar-v2'), '0.5620');
    assert.equal(built('mmaudio-v2-video'), '0.0100');
});

// A pin or cap changed in the capability record changes what a generation
// costs. This fails until the quantity here follows it.
test('each quantity is the pin or cap the capability record sends', () => {
    assert.equal(UNIT_RATES['ace-step'].quantity, REGISTRY['fal-ai/ace-step'].fixed.duration);
    const v15 = REGISTRY['fal-ai/ace-step-1.5'].fixed;
    assert.equal(UNIT_RATES['ace-step-1.5'].quantity, v15.duration * v15.num_outputs);
    assert.equal(UNIT_RATES['ace-step-1.5'].multiplier, v15.thinking ? 2 : 1);
    assert.equal(UNIT_RATES['inworld-tts'].quantity, REGISTRY['fal-ai/inworld-tts'].inputs.prompt.max / 1000);
    assert.equal(UNIT_RATES['kling-avatar-v2'].quantity, REGISTRY['fal-ai/kling-video/ai-avatar/v2/standard'].media.audio.maxSeconds);
    // fal billed 10 seconds for this pin of 8 (migration 0221). A different
    // pin needs a new measurement, not arithmetic.
    assert.equal(REGISTRY['fal-ai/mmaudio-v2'].fixed.duration, 8);
    assert.equal(UNIT_RATES['mmaudio-v2-video'].quantity, 10);
});

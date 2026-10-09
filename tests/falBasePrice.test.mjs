import test from 'node:test';
import assert from 'node:assert/strict';

import {
    baseTally, checkBase, checkPage, checkRow, driftSummary, drifts, driftsExactly, extractBilling, extractPrices, rowLines,
} from '../scripts/lib/fal-price-check.mjs';
import { BASE_PRICES, UNIT_RATES } from '../scripts/lib/fal-unit-rates.mjs';
import { REGISTRY } from '../lib/modelCapabilities.js';

// Cut from fal's model pages as served on 2026-10-09. The object sits in the
// page payload, a script string, so every quote arrives as \" and String.raw
// keeps it that way. Each page carries it three times: twice as
// endpointBilling and once as publicEndpointBilling.
const copy = (endpoint, unit, price, partner = false) => String.raw`{\"endpoint\":\"${endpoint}\",\"billing_unit\":\"${unit}\",\"price\":${price},\"provider_type\":\"${partner ? 'partner' : 'fal'}\",\"is_partner_api\":${partner},\"balance_check\":false,\"enterprise_status\":\"ready\"}`;
const payload = (endpoint, unit, price, partner) => String.raw`\"minimumUnits\":null,\"trainingHistory\":[],\"endpointBilling\":${copy(endpoint, unit, price, partner)},\"publicEndpointBilling\":${copy(endpoint, unit, price, partner)},\"isAdmin\":false,\"authMode\":\"shared\"}]\n"])</script><script>self.__next_f.push([1,"outputTypeMetadata\",\"endpointBilling\":${copy(endpoint, unit, price, partner)},\"endpointMessages\":\"$e1:props:children:1:props:flags\",\"sandboxHref\":null}],[\"$\",\"$Lff\",null,{`;

const KLING = 'fal-ai/kling-video/v3/pro/image-to-video';
// Two cuts as served, character for character, to hold the builder above to.
const ACE_CUT = String.raw`\"endpointBilling\":{\"endpoint\":\"fal-ai/ace-step\",\"billing_unit\":\"seconds\",\"price\":0.0002,\"provider_type\":\"fal\",\"is_partner_api\":false,\"balance_check\":false,\"enterprise_status\":\"ready\"},\"publicEndpointBilling\":{\"endpoint\":\"fal-ai/ace-step\",\"billing_unit\":\"seconds\",\"price\":0.0002,\"provider_type\":\"fal\",\"is_partner_api\":false,\"balance_check\":false,\"enterprise_status\":\"ready\"},\"isAdmin\":false`;
const KLING_CUT = String.raw`\"endpointBilling\":{\"endpoint\":\"fal-ai/kling-video/v3/pro/image-to-video\",\"billing_unit\":\"seconds\",\"price\":0.14,\"provider_type\":\"partner\",\"is_partner_api\":true,\"balance_check\":false,\"enterprise_status\":\"ready\"},\"endpointMessages\"`;
const SEEDREAM = 'fal-ai/bytedance/seedream/v4/text-to-image';
const ACE_PAGE = `<p>Your request will cost $0.0002 per second of generated audio.</p>${payload('fal-ai/ace-step', 'seconds', 0.0002)}`;
// The sentence is the price of one second with audio off; the object is the base.
const KLING_PAGE = `you will be charged **$0.112** (audio off) or **$0.168** (audio on)${payload(KLING, 'seconds', 0.14, true)}`;
// One of the six pages with no "$" figure of its own.
const SEEDREAM_PAGE = `<p>Seedream 4.0 text to image</p>${payload(SEEDREAM, 'images', 0.03, true)}`;

const row = (over) => ({ id: 'row', provider: 'fal', provider_endpoint: 'fal-ai/row', credits_5s: 3, provider_cost_per_unit: 0.04, cost_unit: 'per_generation', billing_seconds: null, active: true, ...over });
const SEEDREAM_ROW = row({ id: 'seedream-4', provider_endpoint: SEEDREAM, credits_5s: 2, provider_cost_per_unit: 0.03 });
const KLING_ROW = row({ id: 'kling-3.0-i2v', provider_endpoint: KLING, credits_5s: 34, provider_cost_per_unit: 0.56, cost_unit: 'per_second', billing_seconds: 5 });
const page = (r, html) => checkPage(r, html, UNIT_RATES, BASE_PRICES);

test("the fixtures are built to the pages' own text", () => {
    assert.ok(payload('fal-ai/ace-step', 'seconds', 0.0002).includes(ACE_CUT));
    assert.ok(payload(KLING, 'seconds', 0.14, true).includes(KLING_CUT));
    assert.deepEqual(extractBilling(ACE_CUT, 'fal-ai/ace-step'), [{ unit: 'seconds', price: 0.0002 }]);
    assert.deepEqual(extractBilling(KLING_CUT, KLING), [{ unit: 'seconds', price: 0.14 }]);
});

test("fal's billing figure is read out of the page payload", () => {
    assert.deepEqual(extractBilling(ACE_PAGE, 'fal-ai/ace-step'), [{ unit: 'seconds', price: 0.0002 }]);
    assert.deepEqual(extractBilling(KLING_PAGE, KLING), [{ unit: 'seconds', price: 0.14 }]);
    assert.deepEqual(extractBilling(SEEDREAM_PAGE, SEEDREAM), [{ unit: 'images', price: 0.03 }]);
    // Units fal writes with a space in them.
    assert.deepEqual(extractBilling(payload('fal-ai/inworld-tts', '1000 characters', 0.01), 'fal-ai/inworld-tts'), [{ unit: '1000 characters', price: 0.01 }]);
    assert.deepEqual(extractBilling(payload('fal-ai/flux-2-pro', 'processed megapixels', 0.03, true), 'fal-ai/flux-2-pro'), [{ unit: 'processed megapixels', price: 0.03 }]);
});

test('the same object without the escaping is read too', () => {
    const plain = ACE_PAGE.replaceAll('\\"', '"');
    assert.ok(plain.includes('"endpointBilling":{"endpoint":"fal-ai/ace-step"'));
    assert.deepEqual(extractBilling(plain, 'fal-ai/ace-step'), [{ unit: 'seconds', price: 0.0002 }]);
});

test('a page with no billing object, or one that cannot be read, gives no figure', () => {
    assert.deepEqual(extractBilling('<p>Your request will cost $0.04 per image.</p>', 'fal-ai/bria/expand'), []);
    assert.deepEqual(extractBilling('', 'fal-ai/ace-step'), []);
    // The price as text, no price, no unit, and an object cut short.
    assert.deepEqual(extractBilling(ACE_PAGE.replaceAll('0.0002,', '\\"0.0002\\",'), 'fal-ai/ace-step'), []);
    assert.deepEqual(extractBilling(ACE_PAGE.replaceAll('\\"price\\":0.0002,', ''), 'fal-ai/ace-step'), []);
    assert.deepEqual(extractBilling(ACE_PAGE.replaceAll('\\"billing_unit\\":\\"seconds\\",', ''), 'fal-ai/ace-step'), []);
    assert.deepEqual(extractBilling(String.raw`\"endpointBilling\":{\"endpoint\":\"fal-ai/ace-step\",\"billing_unit\":\"seconds\",\"price\":0.0`, 'fal-ai/ace-step'), []);
});

test("another endpoint's billing is not this endpoint's", () => {
    assert.deepEqual(extractBilling(ACE_PAGE, 'fal-ai/ace-step-1.5'), []);
    const both = ACE_PAGE + payload('fal-ai/ace-step-1.5', 'units', 0.0003);
    assert.deepEqual(extractBilling(both, 'fal-ai/ace-step'), [{ unit: 'seconds', price: 0.0002 }]);
    assert.deepEqual(extractBilling(both, 'fal-ai/ace-step-1.5'), [{ unit: 'units', price: 0.0003 }]);
});

test('copies that disagree are all returned, not chosen between', () => {
    const split = SEEDREAM_PAGE.replace('\\"price\\":0.03,', '\\"price\\":0.04,');
    assert.deepEqual(extractBilling(split, SEEDREAM), [{ unit: 'images', price: 0.04 }, { unit: 'images', price: 0.03 }]);
});

test('a base price is held to the recorded figure exactly', () => {
    const prices = { [SEEDREAM]: { price: 0.03, unit: 'images' } };
    const at = (unit, price) => checkBase(SEEDREAM, [{ unit, price }], prices).status;
    assert.equal(at('images', 0.03), 'ok');
    // No allowance either way: a hundredth of a cent is a change.
    assert.equal(at('images', 0.0301), 'moved');
    assert.equal(at('images', 0.0299), 'moved');
    assert.equal(at('megapixels', 0.03), 'moved');
    // Gone from the page, or two figures where there was one.
    assert.equal(checkBase(SEEDREAM, [], prices).status, 'moved');
    assert.equal(checkBase(SEEDREAM, [{ unit: 'images', price: 0.03 }, { unit: 'images', price: 0.04 }], prices).status, 'moved');
    // Nothing recorded: nothing compared, and it says which.
    assert.equal(checkBase(SEEDREAM, [{ unit: 'images', price: 0.03 }], {}).status, 'unlisted');
    assert.equal(checkBase('constructor', [], prices).status, 'unlisted');
});

test('a row whose base price matches prints the line it always printed', () => {
    for (const [r, html] of [[SEEDREAM_ROW, SEEDREAM_PAGE], [KLING_ROW, KLING_PAGE]]) {
        const checked = page(r, html);
        assert.equal(checked.base.status, 'ok');
        assert.deepEqual(rowLines(checked), rowLines(checkRow(r, extractPrices(html), UNIT_RATES)));
    }
    assert.deepEqual(rowLines(page(SEEDREAM_ROW, SEEDREAM_PAGE)), ['ok    seedream-4           $0.0300 per generation 2cr  margin 54.5%']);
});

// Seedream's page shows no "$" figure, so until now nothing on it was compared.
test('a base price that moves is reported on a page with no price sentence', () => {
    const raised = page(SEEDREAM_ROW, SEEDREAM_PAGE.replaceAll('\\"price\\":0.03,', '\\"price\\":0.035,'));
    assert.equal(raised.verdict, 'ok');
    assert.equal(raised.base.status, 'moved');
    assert.deepEqual(rowLines(raised), ["DRIFT? seedream-4           expect base price $0.03/images  fal's billing: $0.035/images"]);
    assert.deepEqual(driftSummary(raised), ["expected base price $0.03/images, fal's billing: $0.035/images"]);

    const unit = page(SEEDREAM_ROW, SEEDREAM_PAGE.replaceAll('\\"images\\"', '\\"megapixels\\"'));
    assert.deepEqual(rowLines(unit), ["DRIFT? seedream-4           expect base price $0.03/images  fal's billing: $0.03/megapixels"]);

    const gone = page(SEEDREAM_ROW, '<p>Seedream 4.0 text to image</p>');
    assert.deepEqual(rowLines(gone), ["DRIFT? seedream-4           expect base price $0.03/images  fal's billing: none read from the page"]);
    assert.deepEqual(driftSummary(gone), ["expected base price $0.03/images, fal's billing: none read from the page"]);

    const split = page(SEEDREAM_ROW, SEEDREAM_PAGE.replace('\\"price\\":0.03,', '\\"price\\":0.04,'));
    assert.deepEqual(rowLines(split), ["DRIFT? seedream-4           expect base price $0.03/images  fal's billing: $0.04/images and $0.03/images"]);
});

// Kling's sentence is base x 0.8. Either can change without the other, so
// neither comparison stands in for the other.
test('the price sentence and the base price are checked separately', () => {
    const sentence = page(KLING_ROW, KLING_PAGE.replace('$0.112', '$0.126'));
    assert.equal(sentence.base.status, 'ok');
    assert.deepEqual(rowLines(sentence), ['DRIFT? kling-3.0-i2v        expect $0.1120 /s x 5s  page: $0.126 $0.168']);
    assert.deepEqual(driftSummary(sentence), ['expected $0.1120 /s x 5s, page shows $0.126, $0.168']);

    const base = page(KLING_ROW, KLING_PAGE.replaceAll('\\"price\\":0.14,', '\\"price\\":0.15,'));
    assert.equal(base.verdict, 'ok');
    assert.deepEqual(rowLines(base), ["DRIFT? kling-3.0-i2v        expect base price $0.14/seconds  fal's billing: $0.15/seconds"]);

    const both = page(KLING_ROW, KLING_PAGE.replace('$0.112', '$0.126').replaceAll('\\"price\\":0.14,', '\\"price\\":0.15,'));
    assert.deepEqual(rowLines(both), [
        'DRIFT? kling-3.0-i2v        expect $0.1120 /s x 5s  page: $0.126 $0.168',
        "DRIFT? kling-3.0-i2v        expect base price $0.14/seconds  fal's billing: $0.15/seconds",
    ]);
    assert.deepEqual(driftSummary(both), [
        'expected $0.1120 /s x 5s, page shows $0.126, $0.168',
        "expected base price $0.14/seconds, fal's billing: $0.15/seconds",
    ]);
});

test('a moved base price is reported beside a breach and beside a cost note', () => {
    const moved = SEEDREAM_PAGE.replaceAll('\\"price\\":0.03,', '\\"price\\":0.05,');
    assert.deepEqual(rowLines(page({ ...SEEDREAM_ROW, credits_5s: 1 }, moved)), [
        'BREACH seedream-4           margin 9.1% < 50%',
        "DRIFT? seedream-4           expect base price $0.03/images  fal's billing: $0.05/images",
    ]);
    const ace = row({ id: 'ace-step', provider_endpoint: 'fal-ai/ace-step', credits_5s: 1, provider_cost_per_unit: 0.01 });
    assert.deepEqual(rowLines(page(ace, ACE_PAGE.replaceAll('\\"seconds\\"', '\\"units\\"'))), [
        "DRIFT? ace-step             expect base price $0.0002/seconds  fal's billing: $0.0002/units",
        'COST?  ace-step             records $0.0100, $0.0002 /s x 60 = $0.0120  1cr  margin 63.6% at that cost',
    ]);
});

test('a row with no base price recorded says so in its line', () => {
    const fresh = row({ id: 'new-model', provider_endpoint: 'fal-ai/new-model' });
    const html = `Your request will cost **$0.04** per image.${payload('fal-ai/new-model', 'images', 0.04)}`;
    const checked = page(fresh, html);
    assert.equal(checked.base.status, 'unlisted');
    assert.deepEqual(rowLines(checked), ["ok    new-model            $0.0400 per generation 3cr  margin 59.6%  no base price recorded (fal's billing: $0.04/images)"]);
    assert.deepEqual(driftSummary(checked), []);
    // Whatever the row's last line is carries it.
    assert.deepEqual(rowLines(page({ ...fresh, credits_5s: 2 }, html)), ["BREACH new-model            margin 39.4% < 50%  no base price recorded (fal's billing: $0.04/images)"]);
    assert.deepEqual(rowLines(page(fresh, '<p>nothing</p>')), ["ok    new-model            $0.0400 per generation 3cr  margin 59.6%  no base price recorded (fal's billing: none read from the page)"]);
});

test('the report says how many rows had a base price to compare', () => {
    const clean = page(SEEDREAM_ROW, SEEDREAM_PAGE);
    const moved = page(KLING_ROW, KLING_PAGE.replaceAll('\\"price\\":0.14,', '\\"price\\":0.15,'));
    const fresh = page(row({ provider_endpoint: 'fal-ai/new-model' }), '<p>nothing</p>');
    assert.equal(baseTally([clean, clean]), "base prices: 2 of 2 match fal's billing");
    assert.equal(baseTally([clean, moved]), "base prices: 1 of 2 match fal's billing, 1 moved");
    assert.equal(baseTally([clean, moved, fresh, fresh]), "base prices: 1 of 4 match fal's billing, 1 moved, 2 not recorded");
    assert.equal(baseTally([]), "base prices: 0 of 0 match fal's billing");
});

// What 'listed' fails on: a figure recorded in fal-unit-rates.mjs that moved.
test('a moved base price is drift on an exact figure; a missing "$" figure on an unlisted row is not', () => {
    const baseMoved = page(SEEDREAM_ROW, SEEDREAM_PAGE.replaceAll('\\"price\\":0.03,', '\\"price\\":0.035,'));
    assert.deepEqual([drifts(baseMoved), driftsExactly(baseMoved)], [true, true]);
    // The stray "$4.2" every fal page carried on 2026-09-14, 09-21 and 09-28.
    const stray = page(SEEDREAM_ROW, `$4.2 ${SEEDREAM_PAGE}`);
    assert.equal(stray.verdict, 'drift');
    assert.deepEqual([drifts(stray), driftsExactly(stray)], [true, false]);
    const sentence = page(KLING_ROW, KLING_PAGE.replace('$0.112', '$0.126'));
    assert.deepEqual([drifts(sentence), driftsExactly(sentence)], [true, false]);
    // A listed rate is exact already.
    const ace = row({ id: 'ace-step', provider_endpoint: 'fal-ai/ace-step', credits_5s: 1, provider_cost_per_unit: 0.012 });
    const listed = page(ace, ACE_PAGE.replace('$0.0002', '$0.0004'));
    assert.deepEqual([listed.base.status, drifts(listed), driftsExactly(listed)], ['ok', true, true]);
    const clean = page(SEEDREAM_ROW, SEEDREAM_PAGE);
    assert.deepEqual([drifts(clean), driftsExactly(clean)], [false, false]);
    // A row with nothing recorded is not drift.
    assert.equal(drifts(page(row({ provider_endpoint: 'fal-ai/new-model' }), '<p>nothing</p>')), false);
    // A result checked without a billing figure reads as before.
    assert.equal(drifts(checkRow(SEEDREAM_ROW, [], UNIT_RATES)), false);
});

test('every recorded base price is a unit and a price, for an endpoint the capability record knows', () => {
    for (const [endpoint, recorded] of Object.entries(BASE_PRICES)) {
        assert.ok(REGISTRY[endpoint], `${endpoint} is not in lib/modelCapabilities.js`);
        assert.deepEqual(Object.keys(recorded).sort(), ['price', 'unit'], endpoint);
        assert.ok(Number.isFinite(recorded.price) && recorded.price > 0, endpoint);
        assert.ok(typeof recorded.unit === 'string' && recorded.unit.length > 0, endpoint);
    }
});

// The rate the five unit-priced rows are matched on is the same figure fal
// publishes as the base price. One changed without the other fails here.
test('a listed rate is the base price of its endpoint', () => {
    const endpoints = {
        'ace-step': 'fal-ai/ace-step',
        'ace-step-1.5': 'fal-ai/ace-step-1.5',
        'inworld-tts': 'fal-ai/inworld-tts',
        'kling-avatar-v2': 'fal-ai/kling-video/ai-avatar/v2/standard',
        'mmaudio-v2-video': 'fal-ai/mmaudio-v2',
    };
    assert.deepEqual(Object.keys(UNIT_RATES).sort(), Object.keys(endpoints).sort());
    for (const [id, endpoint] of Object.entries(endpoints)) {
        assert.equal(BASE_PRICES[endpoint].price, UNIT_RATES[id].rate, id);
    }
});

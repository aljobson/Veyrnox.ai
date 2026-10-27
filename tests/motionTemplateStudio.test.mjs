import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MOTION_TRANSFER_TEMPLATES, motionTemplateQuote, visibleMotionTemplates } from '../app/veyrnox/_lib/motionTransferTemplates.js';
import en from '../lib/i18n/messages/app/en/motion-templates.mjs';

const page = readFileSync(new URL('../app/veyrnox/app/motion/page.js', import.meta.url), 'utf8');
const studio = readFileSync(new URL('../app/veyrnox/_components/MotionTemplateStudio.js', import.meta.url), 'utf8');

test('only modes whose flag is on are shown, and readiness comes from the server ids', () => {
    assert.deepEqual(visibleMotionTemplates({ move: false, replace: false }, []), []);
    const move = visibleMotionTemplates({ move: true, replace: false }, ['motion-city-stride']);
    assert.ok(move.length > 0 && move.every(x => x.model === 'motion-transfer'));
    assert.deepEqual(move.filter(x => x.ready).map(x => x.id), ['motion-city-stride']);
    const replace = visibleMotionTemplates({ move: false, replace: true }, ['motion-city-stride']);
    assert.deepEqual(replace.map(x => x.id), ['motion-world-shift-walk', 'motion-stage-swap']);
    assert.ok(replace.every(x => !x.ready), 'a ready id of the other mode does not leak readiness');
});

test('the shown price is the catalog price per 5 s times the clip units, or nothing', () => {
    const five = MOTION_TRANSFER_TEMPLATES.find(x => x.seconds === 5);
    const ten = MOTION_TRANSFER_TEMPLATES.find(x => x.seconds === 10);
    assert.equal(motionTemplateQuote(five, 36), 36);
    assert.equal(motionTemplateQuote(ten, 36), 72);
    for (const bad of [undefined, null, 0, -1, 1.5, '36']) assert.equal(motionTemplateQuote(five, bad), null, String(bad));
});

test('every card has English copy, and the catalog holds no copy for cards that do not exist', () => {
    const ids = new Set(MOTION_TRANSFER_TEMPLATES.map(x => x.id));
    for (const id of ids) {
        assert.ok(en[`app.motion.template.${id}.title`] && en[`app.motion.template.${id}.blurb`], id);
    }
    for (const key of Object.keys(en).filter(k => k.startsWith('app.motion.template.'))) {
        assert.ok(ids.has(key.split('.')[3]), key);
    }
    for (const key of [...studio.matchAll(/'(app\.motion\.[a-zA-Z.]+)'/g)].map(m => m[1])) assert.ok(en[key], `studio uses missing key ${key}`);
    for (const code of ['photo', 'consent', 'upload', 'credits', 'price', 'start']) assert.match(studio, new RegExp(`t\\('app\\.motion\\.error\\.${code}'\\)`), code);
});

test('the page is off unless a flag is on, and sends only clip ids to the browser', () => {
    assert.match(page, /motionTransferEnabled\(process\.env, 'move'\)/);
    assert.match(page, /motionTransferEnabled\(process\.env, 'replace'\)/);
    assert.match(page, /if \(!modes\.move && !modes\.replace\) notFound\(\);/);
    assert.match(page, /export const dynamic = 'force-dynamic';/);
    assert.match(page, /readyIds = MOTION_CLIPS\.filter\(c => c\.ready\)\.map\(c => c\.id\)/);
    assert.doesNotMatch(page, /c\.key|motion\/driving/);
});

test('the studio sends a template id, an uploaded photo reference, consent and the shown price; never a clip or length', () => {
    assert.match(studio, /inputs: \{ motion_template: selected\.drivingClip \}/);
    assert.match(studio, /references: \[\{ origin: 'upload', key: current\.sourceKey, slot: 'image' \}\]/);
    assert.match(studio, /consent: true/);
    assert.match(studio, /confirmed_credits: current\.quote/);
    assert.doesNotMatch(studio, /video_url|duration_seconds/);
});

test('a retry reuses the same key, photo and price; a new price or a change starts a new attempt; one request at a time', () => {
    assert.match(studio, /if \(!attempt\.current \|\| attempt\.current\.quote !== quote\) attempt\.current = \{ key: makeIdempotencyKey\(\), quote, sourceKey: null \};/);
    assert.match(studio, /if \(!current\.sourceKey\) \{/, 'the photo is uploaded once per attempt');
    assert.match(studio, /idempotency_key: current\.key/);
    assert.match(studio, /if \(inflight\.current \|\| !selected\?\.ready \|\| !quote\) return;/);
    assert.match(studio, /function choose\(id\) \{\n    if \(inflight\.current\) return;/);
    assert.match(studio, /disabled=\{busy\} onClick=\{\(\) => choose\(item\.id\)\}/);
    assert.match(studio, /function reset\(\) \{\n    attempt\.current = null;/);
});

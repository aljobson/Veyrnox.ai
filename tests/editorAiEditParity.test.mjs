// Pure document parity: execute the TypeScript phone port and the actual web implementation.
// No simulated device interactions or unverified UI locators are used here.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { checkPlan as webCheck } from '../app/veyrnox/_lib/editorAgentPlan.mjs';
import { validateSequence } from '../app/veyrnox/_lib/editorSequenceValidation.mjs';
import { emptySequence, addSequenceMedia, addSequenceClip, addSequenceText } from '../app/veyrnox/_lib/editorSequence.mjs';
describe('editor AI parity', () => {
const require = createRequire(new URL('../apps/mobile/package.json', import.meta.url));
const ts = require('typescript');
function load(file, deps) {
    const source = readFileSync(new URL(`../apps/mobile/src/lib/${file}.ts`, import.meta.url), 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const exports = {};
    new Function('require', 'exports', code)(name => { if (!(name in deps)) throw Error(`Unexpected dependency ${name}`); return deps[name]; }, exports);
    return exports;
}
const operations = load('editorAgentOperations', { '../../../../app/veyrnox/_lib/editorSequenceValidation.mjs': { validateSequence } });
const phone = load('editorAgentPlan', { './editorAgentOperations': operations, './i18n': { t: key => key } });
const base = () => {
    let tl = addSequenceMedia(emptySequence(), { id: 'l-media', kind: 'video', frames: 3000, name: 'Fixture', hasAudio: true });
    tl = addSequenceClip(tl, 'video', 'l-media', { len: 120 });
    tl = addSequenceClip(tl, 'audio', 'l-media', { len: 120 });
    return addSequenceText(tl, { text: 'Original', start: 0, len: 120 });
};
const commands = [
    { op: 'split', kind: 'video', id: 'v1', frame: 30 }, { op: 'trim', kind: 'video', id: 'v1', edge: 'in', frames: 30 },
    { op: 'trim', kind: 'video', id: 'v1', edge: 'out', frames: 30 }, { op: 'move', kind: 'video', id: 'v1', start: 150 },
    { op: 'remove', kind: 'video', id: 'v1', ripple: true }, { op: 'duplicate', kind: 'video', id: 'v1' },
    { op: 'setVolume', kind: 'audio', id: 'a2', volume: .3 }, { op: 'setSpeed', kind: 'video', id: 'v1', rate: 2 },
    { op: 'addText', text: 'Title', start: 30, len: 90 }, { op: 'setText', id: 't3', text: 'New' },
    { op: 'insertMedia', mediaId: 'l-media', start: 60 }, { op: 'insertMedia', mediaId: 'l-media' },
];
function parity(timeline, plan, expected) {
    const saved = structuredClone(timeline), web = webCheck(timeline, plan), native = phone.checkPlan(timeline, plan);
    assert.equal(native.ok, web.ok);
    if (expected !== undefined) assert.equal(native.ok, expected);
    assert.equal(native.steps.length, web.steps.length);
    if (web.ok) assert.deepEqual(native.next, web.next);
    assert.deepEqual(timeline, saved, 'validation must not mutate the document');
    return native;
}
for (const command of commands) {
    test(`agent parity: ${command.op} ${command.edge ?? command.start ?? ''}`, () => parity(base(), { commands: [command] }, true));
    test(`agent rejects extra fields: ${command.op} ${command.edge ?? command.start ?? ''}`, () => parity(base(), { commands: [{ ...command, unexpected: 1 }] }, false));
    if (command.id || command.mediaId) test(`agent rejects missing target: ${command.op} ${command.edge ?? command.start ?? ''}`, () => parity(base(), { commands: [{ ...command, ...(command.id ? { id: 'v999' } : { mediaId: 'missing' }) }] }, false));
}
for (const patch of [{ rate: 2 }, { rate: .5 }, { rate: 2, reverse: true, in: 1000 }, { fadeIn: 80, fadeOut: 90, transition: 30 },
    { speedCurve: [{ frame: 0, rate: .5 }, { frame: 120, rate: 2 }], reverse: true, in: 1000 },
    { animation: { in: 'fade', out: 'fade', duration: 15, offset: 3, span: 140 }, keyframes: [{ frame: 0, x: .5, y: .5, scale: 1, rotation: 0, opacity: 1, easing: 'linear' }] }]) {
    for (const command of commands.filter(c => ['split', 'trim', 'setSpeed'].includes(c.op))) {
        test(`agent source frames/fades parity: ${command.op} ${command.edge ?? ''} ${JSON.stringify(patch)}`, () => {
            const tl = base(); Object.assign(tl.video[0], patch); parity(tl, { commands: [command] }, true);
        });
    }
}
test('text words are preserved when cleaning leaves the text unchanged', () => {
    const tl = base(); tl.text[0].caption = true; tl.text[0].words = [{ text: 'Original', start: 0, len: 120 }];
    parity(tl, { commands: [{ op: 'setText', id: 't3', text: ' Original ' }] }, true);
    parity(tl, { commands: [{ op: 'split', kind: 'text', id: 't3', frame: 30 }] }, true);
});
test('locked tracks refuse listed operations and never change the document', () => {
    for (const command of commands) {
        const tl = base(); tl.tracks.forEach(track => { track.locked = true; }); parity(tl, { commands: [command] }, false);
    }
});
test('limits, unknown ops and removal guard match web', () => {
    parity(base(), { commands: Array(21).fill(commands[0]) }, false);
    parity(base(), { commands: [commands[0]], extra: 'x'.repeat(16 * 1024) }, false);
    parity(base(), { commands: [{ op: 'notAllowed' }] }, false);
    parity(base(), { commands: [{ op: 'notAllowed' }, commands[0]] }, true);
    parity(base(), { commands: [{ op: 'remove', kind: 'video', id: 'v1' }, { op: 'remove', kind: 'audio', id: 'a2' }] }, false);
    const max = base(); max.video[0].start = 17880;
    parity(max, { commands: [{ op: 'duplicate', kind: 'video', id: 'v1' }] }, false);
    parity(max, { commands: [{ op: 'move', kind: 'video', id: 'v1', start: 18000 }] }, true);
    const full = base(); full.video = Array.from({ length: 40 }, (_, i) => ({ ...full.video[0], id: `v${i + 4}` })); full.seq = 43;
    parity(full, { commands: [{ op: 'split', kind: 'video', id: 'v4', frame: 30 }] }, false);
});
test('remove ripple moves only later clips in the same lane', () => {
    let tl = base(); tl = addSequenceClip(tl, 'video', 'l-media', { start: 150, len: 60 });
    parity(tl, { commands: [commands[4]] }, true);
});
test('freshness rejects project/account/revision change even with identical timeline ids and seq', () => {
    const captured = { projectId: 'project', accountId: 'account', editRevision: 1 };
    for (const changed of [{ projectId: 'other' }, { accountId: 'other' }, { editRevision: 2 }]) {
        const result = phone.checkPlan(base(), { commands: [commands[0]] }, captured, { ...captured, ...changed });
        assert.equal(result.ok, false); assert.equal(result.error, 'editorAi.stale'); assert.equal(result.next, undefined);
    }
});

test('documented UTF-8 boundary is deliberately stricter than the legacy web string-length guard', () => {
    const plan = { commands: [commands[0]], extra: '界'.repeat(6000) };
    assert.equal(webCheck(base(), plan).ok, true); assert.equal(phone.checkPlan(base(), plan).ok, false);
});

});

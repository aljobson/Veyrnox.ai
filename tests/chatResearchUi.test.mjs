import { resolveI18nSource } from '../scripts/lib/vey-knowledge-i18n.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { researchProgressLabel } from '../app/veyrnox/_lib/chatResearchUi.js';

const workspace = readFileSync(new URL('../app/veyrnox/_components/chat/ChatWorkspace.js', import.meta.url), 'utf8');
// send() moved out of the workspace into the useChatSend hook, unchanged, to keep the workspace file under 500 lines.
const sender = readFileSync(new URL('../app/veyrnox/_components/chat/useChatSend.js', import.meta.url), 'utf8');
// The option controls live in the message box's setup row; the settings panel keeps Reset all. The workspace prices and sends them.
const controls = readFileSync(new URL('../app/veyrnox/_components/chat/ComposerControls.js', import.meta.url), 'utf8');
const panel = readFileSync(new URL('../app/veyrnox/_components/chat/SettingsPanel.js', import.meta.url), 'utf8');

test('each step has a plain label, and an unknown or malformed step says nothing', () => {
    assert.equal(researchProgressLabel({ step: 'plan' }), 'Planning the research');
    assert.equal(researchProgressLabel({ step: 'search', done: 2, of: 4 }), 'Searching the web: 2 of 4 done');
    assert.equal(researchProgressLabel({ step: 'search', done: 0, of: 3 }), 'Searching the web: 0 of 3 done');
    assert.equal(researchProgressLabel({ step: 'write' }), 'Writing the answer');
    assert.equal(researchProgressLabel({ step: 'search' }), 'Searching the web', 'no counts: still honest');
    for (const bad of [null, undefined, 'plan', 5, {}, { step: 'x' }, { step: 'search', done: -1, of: 4 }, { step: 'search', done: 1.5, of: 4 }, { step: 'search', done: 1, of: 0 }, { step: 'search', done: '1', of: '4' }]) {
        const label = researchProgressLabel(bad);
        assert.ok(label === null || label === 'Searching the web', JSON.stringify(bad));
    }
    assert.equal(researchProgressLabel({ step: '<script>' }), null, 'a raw step value is never shown');
});

test('the workspace prices research alone and sends only research when it is on', () => {
    assert.match(workspace, /const researchOn = opts\.research && !!offer\.research;/);
    assert.match(workspace, /const chosen = researchOn \? \{ research: true \} : \{ thinking:/);
    assert.match(workspace, /\(model\?\.credits_per_reply \?\? 0\) \+ offer\.research\.extra_credits/);
});

test('research stands in for Thinking and Web search: they are disabled while it is on, and choosing either turns it off', () => {
    assert.match(controls, /aria-pressed=\{opts\.web && !opts\.research\} disabled=\{busy \|\| opts\.research\}/);
    assert.match(controls, /onOpts\(\{ \.\.\.opts, web: !opts\.web, research: false \}\)/);
    assert.match(controls, /onOpts\(optionsForReplyMode\(next, opts\)\)/);
    assert.match(panel, /onOpts\(\{ thinking: false, web: false, research: false \}\)/, 'Reset all turns research off too');
});

test('research cannot be sent with images, and is never shown as free', () => {
    assert.match(workspace, /const imagesBlocked = hasImages && \(!offer\.images \|\| researchOn\);/);
    assert.match(resolveI18nSource(workspace), /Deep research reads text only/);
    assert.match(workspace, /const isFree = freeLeft > 0 && !researchOn &&/);
});

test('the option appears only for a model that offers it, and progress is cleared when a reply ends', () => {
    assert.match(controls, /\{offer\.research && <option value=\{REPLY_MODES\.RESEARCH\}>/);
    assert.doesNotMatch(workspace, /\(offer\.thinking \|\| offer\.web \|\| offer\.research\) && \(/, 'the options are no longer a row above the message box');
    assert.match(sender, /if \(ev === 'progress'\) setProgress\(d\);/);
    assert.match(sender, /finally \{ setBusy\(false\); setProgress\(null\);/);
    assert.match(resolveI18nSource(workspace), /helperCopy\(t, locale, researchProgressLabel\(progress\)\) \|\| "Thinking"/);
});

test('the setup row reads the effective research state, so a stale choice cannot disable Web on a model without Research', () => {
    assert.match(workspace, /<ComposerControls [^>]*opts=\{\{ \.\.\.opts, research: researchOn \}\}/);
});

test('Settings is a real modal (focus contained, Escape closes, focus returns to the chip) with a 44 px hit area', () => {
    assert.match(workspace, /<Modal onCancel=\{\(\) => setSettingsOpen\(false\)\} initialFocusRef=\{settingsCloseRef\}/);
    assert.match(controls, /data-assistant-target="chat\.settings"[^>]*before:-inset-y-1\.5/);
});

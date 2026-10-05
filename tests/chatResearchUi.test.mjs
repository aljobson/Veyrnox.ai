import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { researchProgressLabel } from '../app/veyrnox/_lib/chatResearchUi.js';

const workspace = readFileSync(new URL('../app/veyrnox/_components/chat/ChatWorkspace.js', import.meta.url), 'utf8');

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
    assert.match(workspace, /checked=\{opts\.thinking && !researchOn\} disabled=\{busy \|\| researchOn\}/);
    assert.match(workspace, /checked=\{opts\.web && !researchOn\} disabled=\{busy \|\| researchOn\}/);
    assert.match(workspace, /thinking: e\.target\.checked, research: false/);
    assert.match(workspace, /web: e\.target\.checked, research: false/);
    assert.match(workspace, /setOpts\(\(o\) => \(\{ \.\.\.o, thinking: false, web: false, research: e\.target\.checked \}\)\)/);
});

test('research cannot be sent with images, and is never shown as free', () => {
    assert.match(workspace, /const imagesBlocked = hasImages && \(!offer\.images \|\| researchOn\);/);
    assert.match(workspace, /Deep research reads text only/);
    assert.match(workspace, /const isFree = freeLeft > 0 && !researchOn &&/);
});

test('the option appears only for a model that offers it, and progress is cleared when a reply ends', () => {
    assert.match(workspace, /\{offer\.research && \(/);
    assert.match(workspace, /\(offer\.thinking \|\| offer\.web \|\| offer\.research\) && \(/);
    assert.match(workspace, /if \(ev === 'progress'\) setProgress\(d\);/);
    assert.match(workspace, /finally \{ setBusy\(false\); setProgress\(null\);/);
    assert.match(workspace, /researchProgressLabel\(progress\) \|\| 'Thinking'/);
});

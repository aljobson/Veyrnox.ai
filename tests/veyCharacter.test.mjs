import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { VEY_CHAT_STYLE } from '../lib/veyChatLayout.js';

const root = new URL('../', import.meta.url);

test('mobile questions stay in a short panel with a fixed composer and a scrolling transcript', async () => {
    const source = await readFile(new URL('app/veyrnox/_components/MascotAssistant.jsx', root), 'utf8');
    const guide = await readFile(new URL('app/veyrnox/_components/VeyTaskGuide.jsx', root), 'utf8');
    assert.equal(VEY_CHAT_STYLE['--vey-chat-height'], 'clamp(164px,24dvh,200px)');
    assert.match(source, /style=\{VEY_CHAT_STYLE\}/);
    assert.match(source, /h-\[var\(--vey-chat-height\)\]/);
    assert.match(source, /w-\[min\(280px,calc\(100vw-80px\)\)\]/);
    assert.match(source, /min-h-0 flex-1 overflow-y-auto/);
    assert.match(source, /<form className="mt-auto shrink-0/);
    assert.match(guide, /style=\{VEY_CHAT_STYLE\}/);
    assert.match(guide, /bottom-\[calc\(var\(--vey-chat-height\)/);
});

test('Vey has no floating text badges but retains accessible launcher and movement instructions', async () => {
    const source = await readFile(new URL('app/veyrnox/_components/MascotAssistant.jsx', root), 'utf8');
    assert.doesNotMatch(source, /ASK VEY|POINTING|MOVING|THINKING|TAPPING/);
    assert.match(source, /aria-label=\{open \? t\("public.vey.close"\) : t\("public.vey.open"\)\}/);
    assert.match(source, /id="vey-position-help" className="sr-only"/);
});

test('Vey is articulated into independently animated body parts', async () => {
    const source = await readFile(new URL('app/veyrnox/_components/VeyCharacter.jsx', root), 'utf8');
    for (const part of ['head', 'left-arm', 'left-hand', 'right-arm', 'right-hand', 'left-leg', 'right-leg', 'eyes']) {
        assert.match(source, new RegExp(`data-part="${part}"`), `missing articulated ${part}`);
    }
    for (const pose of ['idle', 'listening', 'walking', 'thinking', 'guiding', 'tapping']) {
        assert.match(source, new RegExp(`['"]${pose}['"]`), `missing ${pose} pose`);
    }
    assert.match(source, /reducedMotion/);
});

test('Vey visibly points and taps before activating an approved target', async () => {
    const source = await readFile(new URL('app/veyrnox/_components/MascotAssistant.jsx', root), 'utf8');
    const pointer = await readFile(new URL('app/veyrnox/_lib/useVeyPointer.js', root), 'utf8');
    assert.match(source, /setActionPhase\('tapping'\)/);
    assert.match(source, /data-testid="assistant-tap"/);
    assert.match(source, /element\.isConnected\) element\.click\(\)/);
    assert.match(pointer, /options\.activate && HELP_TARGETS\[id\]\.canActivate/);
    assert.ok(source.indexOf("setActionPhase('tapping')") < source.indexOf('element.isConnected) element.click()'));
});

test('guide cleanup does not cancel ordinary cross-page help when no task is active', async () => {
    const source = await readFile(new URL('app/veyrnox/_components/VeyTaskGuide.jsx', root), 'utf8');
    assert.match(source, /else if \(!visible \|\| chatting \|\| \['recover', 'waiting'\]\.includes\(step\?\.key\)\) onStop\(\)/);
    assert.doesNotMatch(source, /else onStop\(\)/);
});

test('saved Oddling shortcut does not cover an active Vey conversation', async () => {
    const source = await readFile(new URL('app/veyrnox/_components/VeyTaskGuide.jsx', root), 'utf8');
    assert.match(source, /if \(!task && !choosing\) return chatting \? null : <button/);
});

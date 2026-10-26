import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

// The Workers runtime rejects fetch(..., { redirect: 'error' }) with a TypeError. That made the first
// production render fail at the runner call (runner_transport_fetch_typeerror, 2026-10-26).
test('Worker-side server render code never asks fetch for redirect: error', () => {
    const dir = new URL('../lib/', import.meta.url);
    for (const file of readdirSync(dir).filter(name => /^editorServerRender.*\.js$/.test(name))) {
        assert.doesNotMatch(readFileSync(new URL(file, dir), 'utf8'), /redirect:\s*['"]error['"]/, file);
    }
    assert.match(readFileSync(new URL('editorServerRenderRuntime.js', dir), 'utf8'), /redirect:\s*'manual'/);
});

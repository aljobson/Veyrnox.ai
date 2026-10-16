import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Acquisition CTAs must stay truthful after auth hydration. A neutral Studio
// CTA works for signed-in people and lets the existing gateway request auth
// from signed-out people only when they actually try to spend.
for (const file of ['hero.js', 'footer.js']) {
    test(`${file}: the primary CTA opens Studio without claiming the viewer is signed out`, () => {
        const src = readFileSync(new URL(`../app/veyrnox/_sections/${file}`, import.meta.url), 'utf8');
        const label = file === 'hero.js' ? 'Start creating' : 'Open Studio';
        const i = src.indexOf(label);
        assert.ok(i > 0, 'CTA not found');
        const tag = src.slice(src.lastIndexOf('<Link', i), i);
        assert.match(tag, /href="\/app\/create"/);
        assert.doesNotMatch(src, /Claim 10 credits/);
    });
}

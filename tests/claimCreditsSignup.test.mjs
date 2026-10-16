import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MODELS } from '../app/veyrnox/_lib/tokens.js';

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
        const href = tag.match(/href="([^"]+)"/)?.[1];
        assert.ok(href, 'CTA has no href');
        const modelId = new URL(href, 'https://veyrnox.ai').searchParams.get('model');
        const model = MODELS.find((row) => row.id === modelId);
        assert.ok(model, `CTA must preselect a real model, got ${modelId}`);
        assert.ok(model.credits <= 10, `CTA starts with ${model.credits} credits, more than a new account receives`);
        assert.equal(model.gated, undefined, 'CTA must not preselect a gated model');
        assert.doesNotMatch(src, /Claim 10 credits/);
    });
}

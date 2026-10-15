import test from 'node:test';
import assert from 'node:assert/strict';
import { IMAGE_WALKTHROUGH, nextImageStep } from '../lib/imageWalkthrough.js';
import { HELP_TARGETS, normaliseHelpPlan } from '../lib/productHelp.js';

test('image walkthrough skips unsupported optional controls but never skips a required control', () => {
    const visible = ['create.models', 'create.prompt', 'create.aspect', 'create.count', 'create.cost', 'create.generate'];
    let current = -1;
    const visited = [];
    for (;;) {
        const next = nextImageStep(current, visible);
        if (next.complete) break;
        assert.equal(next.missing, undefined);
        visited.push(next.step.target);
        current = next.index;
    }
    assert.deepEqual(visited, visible);
    assert.deepEqual(nextImageStep(0, ['create.cost']), { missing: 'create.prompt' });
});

test('all walkthrough targets exist and consequential actions remain non-activatable', () => {
    for (const step of IMAGE_WALKTHROUGH) {
        assert.ok(HELP_TARGETS[step.target]);
        assert.notEqual(HELP_TARGETS[step.target].canActivate, true);
        assert.equal(step.activate, undefined);
    }
    for (const target of ['create.generate', 'create.consent', 'create.count', 'create.models']) {
        assert.notEqual(normaliseHelpPlan({ target, action: 'activate_target' }).action, 'activate_target');
    }
});

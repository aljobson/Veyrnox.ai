import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCinemaPrompt, cinemaSuffix, DEFAULT_CINEMA, PROMPT_MAX } from '../app/veyrnox/_lib/cinema.js';

test('the camera text follows the prompt and names every choice', () => {
    const out = buildCinemaPrompt('  a lighthouse at dusk ', { camera: 'Classic 16mm Film', lens: 'Classic Anamorphic', focal: 85, aperture: 'f/11' });
    assert.ok(out.startsWith('a lighthouse at dusk, shot on a classic 16mm film camera'));
    assert.match(out, /classic anamorphic lens at 85mm \(classic portrait perspective\)/);
    assert.match(out, /aperture f\/11, deep focus clarity/);
});

test('the result never exceeds the gateway prompt limit; the user text is what gets cut', () => {
    const out = buildCinemaPrompt('x'.repeat(5000), DEFAULT_CINEMA);
    assert.equal(out.length, PROMPT_MAX);
    assert.ok(out.endsWith(cinemaSuffix(DEFAULT_CINEMA)));
});

test('an empty prompt stays empty, and unknown choices add nothing', () => {
    assert.equal(buildCinemaPrompt('   ', DEFAULT_CINEMA), '');
    assert.doesNotMatch(cinemaSuffix({ camera: '<script>', lens: 'nope', focal: 3, aperture: 'f/2' }), /script|nope|f\/2/);
});

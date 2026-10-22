import test from 'node:test';
import assert from 'node:assert/strict';
import * as web from '../lib/creatorArchetype.js';
import { CREATOR_ANSWERS as webAnswers, CHAOS_MAX as webChaosMax, STUDIO_NAME_MAX as webNameMax } from '../lib/creatorProfile.js';
// Node strips the type annotations; both mobile files are self-contained for this reason.
import * as mobile from '../apps/mobile/src/lib/creatorArchetype.ts';
import { CREATOR_ANSWERS as mobileAnswers, CHAOS_MAX as mobileChaosMax, STUDIO_NAME_MAX as mobileNameMax, isCreatorAnswers } from '../apps/mobile/src/lib/creatorAnswers.ts';

const good = { look: 'neon_rain', goal: 'story', pace: 'octopus', chaos: 2, destination: 'tiktok', audience: 'me', voice: 'calm' };

test('the phone and the web list the same answers', () => {
    assert.deepEqual(JSON.parse(JSON.stringify(mobileAnswers)), JSON.parse(JSON.stringify(webAnswers)));
    assert.equal(mobileChaosMax, webChaosMax);
    assert.equal(mobileNameMax, webNameMax);
});

test('the phone and the web build the same card from every valid answer set', () => {
    for (const look of webAnswers.look) for (const pace of webAnswers.pace) for (const destination of webAnswers.destination) {
        for (let chaos = 0; chaos <= webChaosMax; chaos++) {
            const a = { ...good, look, pace, destination, chaos, studio_name: ' Night Owl ' };
            assert.deepEqual(mobile.creatorCard(a), web.creatorCard(a), JSON.stringify(a));
            assert.equal(mobile.archetypeName(a), web.archetypeName(a));
        }
    }
});

test('they also agree on junk', () => {
    for (const bad of [undefined, null, 5, 'x', [], {}, { pace: '__proto__', chaos: 99, look: 'constructor', destination: 'toString' }, { chaos: '2' }, { chaos: 1.5 }]) {
        assert.deepEqual(mobile.creatorCard(bad), web.creatorCard(bad), JSON.stringify(bad));
    }
    assert.equal(mobile.chaosBand(3), web.chaosBand(3));
});

test('the phone accepts exactly what the server accepts', () => {
    assert.equal(isCreatorAnswers(good), true);
    assert.equal(isCreatorAnswers({ ...good, studio_name: 'ok' }), true);
    for (const bad of [null, [], {}, { ...good, look: 'sepia' }, { ...good, chaos: 5 }, { ...good, chaos: '2' }, { ...good, studio_name: 'x'.repeat(41) }]) {
        assert.equal(isCreatorAnswers(bad), false, JSON.stringify(bad));
    }
});

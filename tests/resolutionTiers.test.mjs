import test from 'node:test';
import assert from 'node:assert/strict';
import { capabilityFor, checkInputs, declaredInputs, shapePayload, publicCapabilities } from '../lib/modelCapabilities.js';
import { tieredCredits, tiersFor, TIER_WEIGHT } from '../lib/resolutionTiers.js';
import { platformsFor, aspectLabel } from '../lib/platformFormats.js';

const veo = capabilityFor('fal-ai/veo3.1');
const nb = capabilityFor('fal-ai/nano-banana-pro');
const kling = capabilityFor('fal-ai/kling-video/v2.6/pro/text-to-video');

test('a model offers only the tiers its provider supports', () => {
    assert.deepEqual(tiersFor(veo), ['720p', '1080p', '4k']);
    assert.deepEqual(tiersFor(nb), ['1080p', '1440p', '4k']);
    assert.deepEqual(tiersFor(kling), []);
});

test('base tier costs the catalog price; higher tiers cost more, never less', () => {
    assert.equal(tieredCredits(10, veo, '720p'), 10);
    assert.equal(tieredCredits(10, veo, undefined), 10);
    assert.equal(tieredCredits(10, veo, '1080p'), 15);
    assert.equal(tieredCredits(10, veo, '4k'), 35);
    assert.equal(tieredCredits(10, nb, '1440p'), 10);
    assert.ok(tieredCredits(10, nb, '1080p') <= 10);
    assert.equal(tieredCredits(10, nb, '1080p'), 10);
    assert.equal(tieredCredits(10, nb, '4k'), 16);
    assert.ok(TIER_WEIGHT['1440p'] > TIER_WEIGHT['1080p']);
});

test('an unsupported tier is refused and an unknown model ignores it', () => {
    assert.equal(checkInputs(veo, { prompt: 'x', resolution: '1440p' }).error, 'resolution_not_supported');
    assert.equal(checkInputs(veo, { prompt: 'x', resolution: '4k' }).ok, true);
    assert.deepEqual(declaredInputs(kling, { prompt: 'x', resolution: '4k' }), { prompt: 'x' });
});

test('the chosen tier lands in the provider payload; base keeps the pin', () => {
    assert.equal(shapePayload(veo, { prompt: 'x', resolution: '4k' }).resolution, '4k');
    assert.equal(shapePayload(veo, { prompt: 'x' }).resolution, '720p');
    assert.equal(shapePayload(nb, { prompt: 'x', resolution: '4k' }).resolution, '4K');
    assert.equal(shapePayload(nb, { prompt: 'x' }).resolution, '2K');
});

test('public capabilities publish the multipliers', () => {
    const t = publicCapabilities(veo).resolutionTiers;
    assert.equal(t.base, '720p');
    assert.deepEqual(t.options.map(o => o.id), ['720p', '1080p', '4k']);
    assert.equal(publicCapabilities(kling).resolutionTiers, undefined);
});

test('ratios show the platforms they fit', () => {
    assert.ok(platformsFor('9:16').includes('TikTok'));
    assert.ok(platformsFor('16:9').includes('YouTube'));
    assert.equal(aspectLabel('9:16'), '9:16 · TikTok, Reels');
    assert.equal(aspectLabel('5:4'), '5:4');
});

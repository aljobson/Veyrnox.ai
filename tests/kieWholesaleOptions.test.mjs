import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRequest, parseEndpoint } from '../packages/adapters/kie.js';
import { capabilityFor } from '../lib/modelCapabilities.js';
import { buildKieDialogue, KIE_DIALOGUE_VOICES } from '../lib/kieDialogue.js';

const dialogue = 'market:elevenlabs/text-to-dialogue-v3';
const flux = 'market:flux-2/pro-text-to-image';

test('dialogue keeps repeated speakers stable, limits four voices and rejects over-budget scripts', () => {
    const prompt = 'Ana: Hello.\nBen: Welcome.\nCara: Good morning.\nDan: Goodbye.\nAna: Until tomorrow.';
    const req = buildRequest(parseEndpoint(dialogue), { prompt });
    assert.equal(req.ok, true);
    assert.deepEqual(req.body.input.dialogue.map(b => b.voice), [...KIE_DIALOGUE_VOICES, KIE_DIALOGUE_VOICES[0]]);
    assert.equal(req.body.input.dialogue[4].text, 'Until tomorrow.');
    assert.equal(buildKieDialogue(prompt + '\nEve: A fifth voice.').ok, false);
    assert.equal(buildKieDialogue('x'.repeat(1000)).ok, true);
    assert.equal(buildKieDialogue('x'.repeat(1001)).ok, false);
    assert.equal(buildKieDialogue('  ').ok, false);
    assert.equal(capabilityFor(dialogue).validate({ prompt: prompt + '\nEve: No.' }).ok, false);
});

test('both wholesale options reject unsupported seed, source media and tier overrides', () => {
    for (const ep of [dialogue, flux]) {
        assert.equal(capabilityFor(ep).inputs.seed, undefined);
        for (const [key, value] of Object.entries({ seed: 1, image_url: 'https://example.com/a.png', voice: 'Rachel', resolution: '2K' })) {
            assert.equal(buildRequest(parseEndpoint(ep), { prompt: 'A valid prompt', [key]: value }).ok, false);
        }
    }
    assert.ok(capabilityFor('fal-ai/flux-2-pro').inputs.seed);
    assert.ok(capabilityFor('fal-ai/elevenlabs/text-to-dialogue/eleven-v3').inputs.seed);
});

test('Flux is bounded to one 1K image with moderation on and valid documented aspects', () => {
    const req = buildRequest(parseEndpoint(flux), { prompt: 'A ceramic teapot' });
    assert.deepEqual(req.body.input, { prompt: 'A ceramic teapot', aspect_ratio: '4:3', resolution: '1K', nsfw_checker: true });
    assert.equal(buildRequest(parseEndpoint(flux), { prompt: 'hi' }).ok, false);
    assert.equal(buildRequest(parseEndpoint(flux), { prompt: 'x'.repeat(2001) }).ok, false);
    assert.equal(buildRequest(parseEndpoint(flux), { prompt: 'a cat', aspect_ratio: '21:9' }).ok, false);
});

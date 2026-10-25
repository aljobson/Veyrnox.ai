import test from 'node:test';
import assert from 'node:assert/strict';
import { SOCIAL_NETWORKS } from '../lib/social/networks.js';
import { carouselAdmission, postCapabilityError } from '../lib/social/postCapabilities.js';
import { carouselMediaError } from '../lib/social/carouselDispatch.js';
import { selectionLimit, selectionBlocker, toggleMedia, moveMedia, orderedMediaSignature } from '../lib/social/carouselSelection.js';

const env = { PUBLISH_CAROUSEL_ENABLED: 'true', PUBLISH_EXTENDED_NETWORKS_ENABLED: 'true', PUBLISH_VIDEO_DESTINATIONS_ENABLED: 'true',
    PUBLIC_HOST: 'https://veyrnox.test', SOCIAL_MEDIA_PROXY_SECRET: 'secret' };
const images = count => Array.from({ length: count }, () => ({ media_type: 'image' }));
const caps = { instagram: 10, linkedin: 9, twitter: 4, tiktok: 10, facebook: 10, threads: 10, bluesky: 4 };

for (const network of SOCIAL_NETWORKS) test(`${network.key}: single behavior and carousel count/type boundaries`, () => {
    const accounts = [{ network: network.key }];
    for (const type of ['image', 'video']) assert.equal(postCapabilityError(accounts, [{ media_type: type }], '', env),
        !network.media.length ? 'publishing_not_supported' : network.media.includes(type) ? null : 'unsupported_media_type');
    if (caps[network.key]) {
        for (const count of [2, caps[network.key]]) assert.equal(carouselAdmission(accounts, images(count), env), null);
        assert.deepEqual(carouselAdmission(accounts, images(caps[network.key] + 1), env), { error: 'media_count_not_supported', network: network.key });
    } else assert.deepEqual(carouselAdmission(accounts, images(2), env), { error: 'media_count_not_supported', network: network.key });
    for (const media of [[{ media_type: 'image' }, { media_type: 'video' }], [{ media_type: 'video' }, { media_type: 'video' }]]) {
        assert.deepEqual(carouselAdmission(accounts, media, env), network.key === 'instagram' ? null : { error: 'media_count_not_supported', network: network.key });
    }
});
test('the exact flag gates every multi-file request, even with no accounts; single files ignore it', () => {
    for (const value of [undefined, false, true, 'false', 'TRUE', '1']) {
        assert.deepEqual(carouselAdmission([], images(2), { ...env, PUBLISH_CAROUSEL_ENABLED: value }), { error: 'carousel_not_open' });
        assert.equal(carouselAdmission([], images(1), { ...env, PUBLISH_CAROUSEL_ENABLED: value }), null);
    }
    assert.deepEqual(carouselAdmission([{ network: 'instagram' }, { network: 'twitter' }], images(5), env), { error: 'media_count_not_supported', network: 'twitter' });
    assert.equal(postCapabilityError([{ network: 'instagram' }], images(2), '', { ...env, PUBLISH_RELEASED_NETWORKS: 'youtube' }), 'network_unavailable');
    assert.deepEqual(carouselAdmission([{ network: 'instagram' }], [{ media_type: 'video' }, { media_type: 'image' }], { ...env, PUBLISH_VIDEO_DESTINATIONS_ENABLED: 'false' }), { error: 'media_count_not_supported', network: 'instagram' });
});
test('every ordered item requires valid metadata; none is silently dropped', () => {
    const media = images(3).map((item, position) => ({ ...item, position, r2_key: `${position}.jpg`, mime_type: 'image/jpeg', size_bytes: 100 }));
    assert.equal(carouselMediaError('instagram', media), null);
    for (const index of [0, 1, 2]) for (const change of [{ r2_key: null }, { position: 8 }, { size_bytes: null }, { size_bytes: -1 }, { size_bytes: 'x' }, { mime_type: 'video/mp4' }, { size_bytes: 100000000 }]) {
        assert.ok(carouselMediaError('instagram', media.map((item, i) => i === index ? { ...item, ...change } : item)));
    }
});
test('selection limits, removal, reordering and full ordered identities', () => {
    const a = { jobId: 'a', mediaType: 'image' }, b = { uploadId: 'b', mediaType: 'image' };
    assert.equal(selectionLimit([{ network: 'instagram' }, { network: 'twitter' }], true), 4);
    assert.equal(selectionLimit([{ network: 'youtube' }], true), 1);
    assert.equal(selectionLimit([], false), 1);
    assert.deepEqual(toggleMedia([a], b, 4), [a, b]);
    assert.deepEqual(toggleMedia([a, b], a, 4), [b]);
    assert.deepEqual(moveMedia([a, b], 0, 1), [b, a]);
    assert.deepEqual(selectionBlocker([{ network: 'youtube' }], [a, b], true), { error: 'media_count_not_supported', network: 'youtube' });
    const original = orderedMediaSignature([a, b]);
    for (const next of [[a], [a, b, { jobId: 'c', mediaType: 'image' }], [b, a], [a, { ...b, uploadId: 'c' }], [a, { ...b, mediaType: 'video' }]]) assert.notDeepEqual(orderedMediaSignature(next), original);
    assert.deepEqual(orderedMediaSignature([a, b]), original);
});

test('public carousel guidance derives all limits from the catalogue and omits deployment flags', async () => {
    const { carouselDocumentation } = await import('../lib/social/carouselDocumentation.js');
    const docs = carouselDocumentation();
    for (const network of SOCIAL_NETWORKS.filter(n => n.carousel)) assert.ok(docs.includes(`${network.label}: ${network.carousel.min}-${network.carousel.max}`));
    assert.match(docs, /Multiple files may not be enabled for the account/);
    assert.match(docs, /carousel_not_open/);
    assert.doesNotMatch(docs, /PUBLISH_CAROUSEL_ENABLED|Ordered attachments\./);
});

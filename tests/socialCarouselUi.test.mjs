import test from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import { fixture } from './helpers/publicSiteRender.mjs';
import { appMessagesFor } from '../lib/i18n/appMessages.mjs';
import { translator } from '../lib/i18n/translate.mjs';
import { LOCALES } from '../lib/i18n/locales.mjs';

const media = [{ jobId: 'first', mediaType: 'image', thumbUrl: 'https://media.test/first.jpg' }, { uploadId: 'second', mediaType: 'video', thumbUrl: 'https://media.test/second.mp4' }];
for (const { code } of LOCALES) test(`ordered carousel preview and destination blocker render in ${code}`, async () => {
    const messages = await appMessagesFor(code), t = translator(code, messages);
    const file = 'app/veyrnox/app/publish/Composer.js';
    const f = fixture(code, '/app/publish', { messages, signedIn: true,
        states: { [file]: [new Set(['x']), '', {}, '', 'private', '2030-01-01T10:00', media] } });
    const html = f.render(React.createElement(f.load(file).Composer, { carouselEnabled: true,
        accounts: [{ id: 'x', network: 'twitter', status: 'active', publishingEnabled: true, supportedMedia: ['image'] }] }));
    assert.ok(html.includes('first.jpg')); assert.ok(html.includes('second.mp4'));
    assert.ok(html.includes(t('app.publish.carousel.blocked', { network: 'X' })));
    assert.ok(html.includes(t('app.publish.carousel.limit', { count: 2, max: 4 })));
    const strip = html.slice(html.indexOf('<ol'));
    assert.ok(strip.indexOf(t('app.publish.carousel.item', { count: 1 })) < strip.indexOf(t('app.publish.carousel.item', { count: 2 })));
    assert.doesNotMatch(html, /app\.publish\./);
});
test('review renders every attachment in order and a held item without its preview', async () => {
    const file = 'app/social/review/[token]/page.js', messages = await appMessagesFor('en');
    const f = fixture('en', '/social/review/token', { messages, states: { [file]: [{
        networks: [], targets: [], decision: 'approved', request_status: 'approved', scheduled_at: '2030-01-01',
        attachments: [{ media_type: 'image', preview_url: '/first.jpg' }, { media_type: 'image', held: true, preview_url: '/must-not-render.jpg' }, { media_type: 'video', preview_url: '/last.mp4' }],
    }] } });
    const html = f.render(React.createElement(f.load(file).default));
    assert.ok(html.includes('/first.jpg')); assert.ok(html.includes('/last.mp4')); assert.ok(html.includes('File 3'));
    assert.doesNotMatch(html, /must-not-render/);
});

test('single-only destinations do not show the carousel maximum line', async () => {
    const file = 'app/veyrnox/app/publish/CarouselSelection.js', messages = await appMessagesFor('en');
    const f = fixture('en', '/app/publish', { messages });
    const html = f.render(React.createElement(f.load(file).default, { items: media.slice(0, 1), max: 1, onChange() {} }));
    assert.doesNotMatch(html, /Maximum/);
});
for (const queueNetwork of ['instagram', 'twitter']) test(`queue blockers use ${queueNetwork} configuration and actual reservation accounts`, async () => {
    const file = 'app/veyrnox/app/publish/Composer.js', messages = await appMessagesFor('en');
    const runtime = await import('react/jsx-runtime');
    let submit, reserved = 0, created = 0;
    const intercept = fn => (type, props, ...rest) => { if (type === 'form') submit = props.onSubmit; return fn(type, props, ...rest); };
    const items = Array.from({ length: 5 }, (_, i) => ({ jobId: `job-${i}`, mediaType: 'image' }));
    const f = fixture('en', '/app/publish', { messages, signedIn: true,
        states: { [file]: [new Set(['instagram']), '', {}, '', 'private', '2030-01-01T10:00', items, false, '', false, false, false, '', '', [{ id: 'q', name: 'Queue', account_ids: [queueNetwork] }], 'q', '', 'all', []] },
        moduleMocks: {
            'react/jsx-runtime': { ...runtime, jsx: intercept(runtime.jsx), jsxs: intercept(runtime.jsxs) },
            '../../../lib/socialPostsClient.js': { newIdempotencyKey: () => 'key', createSocialPost: async () => { created++; return {}; } },
            '../../../lib/socialQueuesClient.js': { reserveSocialQueueSlot: async () => { reserved++; return { account_ids: ['twitter'], scheduled_at: '2030-01-01T10:00', assignment_id: 'slot' }; } },
        } });
    const html = f.render(React.createElement(f.load(file).Composer, { carouselEnabled: true, accounts: ['instagram', 'twitter'].map(network => ({ id: network, network, status: 'active', publishingEnabled: true, supportedMedia: ['image'] })) }));
    if (queueNetwork === 'twitter') {
        assert.ok(html.includes(translator('en', messages)('app.publish.carousel.blocked', { network: 'X' })));
        assert.ok(html.includes('Maximum 4'));
    }
    assert.equal(typeof submit, 'function');
    await submit({ preventDefault() {}, nativeEvent: { submitter: { value: 'queue' } } });
    assert.equal(reserved, queueNetwork === 'instagram' ? 1 : 0);
    assert.equal(created, 0);
});

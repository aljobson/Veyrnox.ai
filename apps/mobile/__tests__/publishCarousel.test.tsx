import { act } from 'react';
import * as RN from 'react-native';
import { createRoot } from 'test-renderer';
import { PublishMediaSelection } from '../src/components/PublishMediaSelection';
import { createBody, validateDraft, mediaBlocker, type Draft, type PostMedia } from '../src/lib/publishCompose';
import { approvalBody, signatureOf, type ApprovalDraft } from '../src/lib/publishApprovalCreate';
import { createDraftKeys, draftSignature } from '../src/lib/draftKey';
import { createMemoryStorage } from '../src/lib/cache';
import { parseReview } from '../src/lib/shareLinks';
import type { PublishAccount } from '../src/lib/publish';
import type { MediaChoice } from '../src/lib/publishMediaChoice';

void [RN.Pressable, RN.Text, RN.View];
const media: PostMedia[] = [{ jobId: 'one', mediaType: 'image' }, { uploadId: 'two', mediaType: 'image' }];
const now = new Date('2026-10-25T12:00:00Z');
const draft: Draft = { jobId: '', mediaType: 'image', media, accountIds: ['a'], text: 'Carousel', when: { kind: 'now' } };
const approval: ApprovalDraft = { ...draft, scheduledAt: new Date('2026-10-26T12:00:00Z'), reviewers: ['r@example.com'], policy: 'all' };
const account = { id: 'a', network: 'twitter', displayName: 'X', supportedMedia: ['image'], carousel: { min: 2, max: 4, types: ['image'] } } as PublishAccount;

test('post and approval payloads preserve full attachment order; all media changes invalidate retry keys', async () => {
    expect(createBody(draft, 'key', now).media).toEqual(media);
    expect(approvalBody(approval, 'key').media).toEqual(media);
    expect(validateDraft(draft, [account], now)).toBeNull();
    let number = 0;
    const keys = createDraftKeys(createMemoryStorage(), () => now.getTime(), () => `carousel-${++number}`);
    const signature = draftSignature(draft), approvalSignature = signatureOf(approval);
    const key = await keys.keyFor('owner', signature);
    expect(await keys.keyFor('owner', draftSignature({ ...draft, media: [...media] }))).toBe(key);
    expect(signatureOf({ ...approval, media: [...media] })).toBe(approvalSignature);
    for (const next of [[...media, { jobId: 'three', mediaType: 'image' }], media.slice(0, 1), [...media].reverse(),
        [media[0], { uploadId: 'replacement', mediaType: 'image' }], [media[0], { uploadId: 'two', mediaType: 'video' }]] as PostMedia[][]) {
        expect(draftSignature({ ...draft, media: next })).not.toBe(signature);
        expect(signatureOf({ ...approval, media: next })).not.toBe(approvalSignature);
        expect(await keys.keyFor('owner', draftSignature({ ...draft, media: next }))).not.toBe(key);
    }
});

test('blockers identify count, type and single-only destinations without dropping selected media', () => {
    expect(mediaBlocker(media, [account])).toBeNull();
    expect(mediaBlocker([...media, ...media, media[0]], [account])).toBe('twitter');
    expect(mediaBlocker([media[0], { uploadId: 'v', mediaType: 'video' }], [account])).toBe('twitter');
    expect(mediaBlocker(media, [{ ...account, network: 'gmb', carousel: undefined }])).toBe('gmb');
    expect(mediaBlocker(media, [{ ...account, carousel: undefined }])).toBe('twitter');
});

test('review parser preserves every attachment and suppresses held previews', () => {
    const review = parseReview({ attachments: [{ media_type: 'image', preview_url: '/media/social/first' },
        { media_type: 'image', held: true, preview_url: '/media/social/held' }, { media_type: 'video', preview_url: '/media/social/last' }] });
    expect(review.attachments.map(item => item.mediaType)).toEqual(['image', 'image', 'video']);
    expect(review.attachments[0].previewUrl).toMatch(/\/first$/);
    expect(review.attachments[1].previewUrl).toBeNull();
    expect(review.attachments[2].previewUrl).toMatch(/\/last$/);
});

test('ordered chips reorder and remove the requested attachment and disable boundary moves', async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const root = createRoot(), onChange = jest.fn();
    const items: MediaChoice[] = [{ kind: 'upload', uploadId: 'one', mediaType: 'image' }, { kind: 'upload', uploadId: 'two', mediaType: 'image' }];
    try {
        await act(async () => root.render(<PublishMediaSelection items={items} max={4} onChange={onChange} disabled={false} />));
        const buttons = root.container.queryAll(n => n.props.accessibilityRole === 'button');
        expect(buttons).toHaveLength(6);
        expect(buttons[0].props.accessibilityState.disabled).toBe(true);
        expect(buttons[4].props.accessibilityState.disabled).toBe(true);
        await act(async () => buttons[1].props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 }));
        expect(onChange).toHaveBeenLastCalledWith([items[1], items[0]]);
        await act(async () => buttons[2].props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 }));
        expect(onChange).toHaveBeenLastCalledWith([items[1]]);
    } finally { await act(async () => root.unmount()); }
});

for (const max of [0, 1, 4]) test(`selection maximum is shown only for multiple capacity: ${max}`, async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const root = createRoot();
    try {
        await act(async () => root.render(<PublishMediaSelection items={[{ kind: 'upload', uploadId: 'one', mediaType: 'image' }]} max={max} onChange={() => {}} disabled={false} />));
        const text = root.container.queryAll(n => n.children.some(c => typeof c === 'string')).flatMap(n => n.children.filter(c => typeof c === 'string')).join(' ');
        expect(text.includes('Maximum')).toBe(max > 1);
    } finally { await act(async () => root.unmount()); }
});

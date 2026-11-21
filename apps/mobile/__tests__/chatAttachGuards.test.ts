import { imagesBlocked, orderedAttachmentRefs, photoNoticeKey, refsForSend } from '../src/lib/chatAttach';

describe('imagesBlocked (ATT-04)', () => {
    test('chosen images block Send on a model that cannot read them, instead of being dropped', () => {
        expect(imagesBlocked(1, null)).toBe(true);
        expect(imagesBlocked(4, null)).toBe(true);
    });
    test('no images, or a model that reads images (even at no extra cost), never blocks', () => {
        expect(imagesBlocked(0, null)).toBe(false);
        expect(imagesBlocked(2, 0)).toBe(false);
        expect(imagesBlocked(2, 3)).toBe(false);
    });
});

describe('photoNoticeKey (ATT-05)', () => {
    test('a photo that could not be read is explained', () => {
        expect(photoNoticeKey('failed')).toBe('chat.attach.photoFailed');
        expect(photoNoticeKey('resize_unavailable')).toBe('chat.attach.needsUpdate');
    });
    test('a cancelled or clean pick says nothing', () => {
        expect(photoNoticeKey(null)).toBeNull();
    });
});

describe('orderedAttachmentRefs (ATT-06)', () => {
    test('keeps the order the images are shown in, uploads and Library images mixed', () => {
        const images = [
            { id: 'a', assetId: 'LIB-1' },
            { id: 'b', uri: 'file:///b.jpg' },
            { id: 'c', assetId: 'lib-2' },
            { id: 'd', uri: 'file:///d.jpg' },
        ];
        expect(orderedAttachmentRefs(images, ['k-b', 'k-d'])).toEqual([
            { source_asset: 'lib-1' }, { source_key: 'k-b' }, { source_asset: 'lib-2' }, { source_key: 'k-d' },
        ]);
    });
});

describe('refsForSend (ATT-REVIEW-05)', () => {
    const images = [{ id: 'p', uri: 'file:///p.jpg' }, { id: 'l', assetId: 'lib-1' }];

    test('a retry of an unsettled send reuses its storage keys and uploads nothing', async () => {
        let n = 0;
        const upload = jest.fn(async (files: readonly unknown[]) => files.map(() => `uploads/u/${++n}.jpg`));
        const first = await refsForSend('send-1', null, images, upload);
        const retry = await refsForSend('send-1', first, images, upload);
        expect(upload).toHaveBeenCalledTimes(1);
        expect(retry.refs).toEqual([{ source_key: 'uploads/u/1.jpg' }, { source_asset: 'lib-1' }]);
    });

    test('a new send (new key) uploads afresh', async () => {
        let n = 0;
        const upload = jest.fn(async (files: readonly unknown[]) => files.map(() => `uploads/u/${++n}.jpg`));
        const first = await refsForSend('send-1', null, images, upload);
        const next = await refsForSend('send-2', first, images, upload);
        expect(upload).toHaveBeenCalledTimes(2);
        expect(next).toEqual({ key: 'send-2', refs: [{ source_key: 'uploads/u/2.jpg' }, { source_asset: 'lib-1' }] });
    });
});

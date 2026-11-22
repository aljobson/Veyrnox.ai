import { editorPersonMasks, editorVideoPersonMask, EDITOR_PERSON_MASK_CATEGORIES, EDITOR_PERSON_MASK_GATE } from '../src/lib/editorPersonMask';

const mockDelete = jest.fn();
jest.mock('expo-file-system', () => ({ File: class { exists = true; constructor(public uri: string) {} delete() { mockDelete(this.uri); } } }));

const jpeg = 'data:image/jpeg;base64,/9j/';
const bytes = (length: number, value: number) => Buffer.alloc(length, value).toString('base64');
const png = () => Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString('base64');

test('declares honest named platform gates', () => {
    expect(EDITOR_PERSON_MASK_GATE.ios).toMatchObject({ available: true, minimumVersion: '16.4' });
    expect(EDITOR_PERSON_MASK_GATE.android).toEqual({ available: false, reason: 'android-editor-semantic-mask-not-qualified' });
});

test('requires New Architecture capability and exact bounded mask planes', async () => {
    const native = { init: jest.fn(async () => {}), capabilities: jest.fn(async () => ({ ok: true, platform: 'ios', semanticMask: true,
        architecture: 'expo-modules-new-architecture' })), detect: jest.fn(async () => ({ width: 8, height: 8,
        ...Object.fromEntries(EDITOR_PERSON_MASK_CATEGORIES.map((name, index) => [name, bytes(64, index)])),
        maskPngs: Object.fromEntries(EDITOR_PERSON_MASK_CATEGORIES.map(name => [name, png()])) })), cancel: jest.fn() };
    const result = await editorPersonMasks(jpeg, 8, 8, undefined, native);
    expect(result.ok).toBe(true);
    if (result.ok) expect(Object.keys(result.masks)).toEqual(EDITOR_PERSON_MASK_CATEGORIES);
    expect(native.detect).toHaveBeenCalledWith(expect.stringMatching(/^editor-/), expect.stringMatching(/^editor-/), 'semanticMask', jpeg, 8, 8);
});

test('rejects short planes and cancels by owner/token', async () => {
    const controller = new AbortController();
    const native = { init: jest.fn(async () => {}), capabilities: jest.fn(async () => ({ ok: true, platform: 'ios', semanticMask: true,
        architecture: 'expo-modules-new-architecture' })), detect: jest.fn(async () => ({ width: 8, height: 8,
        ...Object.fromEntries(EDITOR_PERSON_MASK_CATEGORIES.map(name => [name, bytes(name === 'person' ? 63 : 64, 1)])),
        maskPngs: Object.fromEntries(EDITOR_PERSON_MASK_CATEGORIES.map(name => [name, png()])) })), cancel: jest.fn() };
    await expect(editorPersonMasks(jpeg, 8, 8, undefined, native)).resolves.toEqual({ ok: false, code: 'invalid-result' });
    controller.abort();
    await expect(editorPersonMasks(jpeg, 8, 8, controller.signal, native)).resolves.toEqual({ ok: false, code: 'cancelled' });
});

test.each([
    undefined,
    Object.fromEntries(EDITOR_PERSON_MASK_CATEGORIES.map(name => [name, name === 'person' ? 'bm90LXBuZw==' : png()])),
])('rejects missing or invalid mask PNG output', async maskPngs => {
    const native = { init: jest.fn(async () => {}), capabilities: jest.fn(async () => ({ ok: true, platform: 'ios', semanticMask: true,
        architecture: 'expo-modules-new-architecture' })), detect: jest.fn(async () => ({ width: 8, height: 8,
        ...Object.fromEntries(EDITOR_PERSON_MASK_CATEGORIES.map(name => [name, bytes(64, 1)])), ...(maskPngs ? { maskPngs } : {}) })), cancel: jest.fn() };
    await expect(editorPersonMasks(jpeg, 8, 8, undefined, native)).resolves.toEqual({ ok: false, code: 'invalid-result' });
});

test('validates bounded time-indexed moving-video mask artifacts', async () => {
    const native = { init: jest.fn(async () => {}), capabilities: jest.fn(async () => ({ ok: true, platform: 'ios', semanticMaskVideo: true,
        architecture: 'expo-modules-new-architecture' })), detect: jest.fn(), segmentVideo: jest.fn(async () => ({ ok: true,
        uri: 'file:///cache/veyrnox-editor-media/account/project/vx-semantic-mask-2-test.mp4', bytes: 10_000, width: 256, height: 144,
        frames: 3, fps: 30, durationSeconds: .1, videoCodec: 'avc1', generation: 2 })), cancel: jest.fn() };
    await expect(editorVideoPersonMask('account', 'project', 2, 'file:///cache/veyrnox-editor-media/account/project/source.mp4', [1, 1.033, 1.066], 30, 'person', undefined, native))
        .resolves.toMatchObject({ ok: true, uri: 'file:///cache/veyrnox-editor-media/account/project/vx-semantic-mask-2-test.mp4', frames: 3, fps: 30 });
    expect(native.segmentVideo).toHaveBeenCalledWith('account', 'project', 2, expect.stringMatching(/^editor-/), expect.stringMatching(/^editor-/),
        'file:///cache/veyrnox-editor-media/account/project/source.mp4', [1, 1.033, 1.066], 30, 'person');
});

test('moving masks refuse foreign paths and delete a late native success after abort', async () => {
    const controller = new AbortController(), uri = 'file:///cache/veyrnox-editor-media/account/project/vx-semantic-mask-2-late.mp4';
    const native = { init: jest.fn(async () => {}), capabilities: jest.fn(async () => ({ ok: true, platform: 'ios', semanticMaskVideo: true,
        architecture: 'expo-modules-new-architecture' })), detect: jest.fn(), segmentVideo: jest.fn(async () => { controller.abort(); return { ok: true,
        uri, bytes: 100, width: 8, height: 8, frames: 1, fps: 30, durationSeconds: 1 / 30, videoCodec: 'avc1', generation: 2 }; }), cancel: jest.fn() };
    await expect(editorVideoPersonMask('account', 'project', 2, 'file:///cache/veyrnox-editor-media/other/project/source.mp4', [1], 30, 'person', undefined, native))
        .resolves.toEqual({ ok: false, code: 'invalid-result' });
    expect(native.segmentVideo).not.toHaveBeenCalled();
    await expect(editorVideoPersonMask('account', 'project', 2, 'file:///cache/veyrnox-editor-media/account/project/source.mp4', [1], 30, 'person', controller.signal, native))
        .resolves.toEqual({ ok: false, code: 'cancelled' });
    // Use a fresh signal so cancellation happens after the native result has already been written.
    const late = new AbortController(); native.segmentVideo.mockImplementationOnce(async () => { late.abort(); return { ok: true,
        uri, bytes: 100, width: 8, height: 8, frames: 1, fps: 30, durationSeconds: 1 / 30, videoCodec: 'avc1', generation: 2 }; });
    await expect(editorVideoPersonMask('account', 'project', 2, 'file:///cache/veyrnox-editor-media/account/project/source.mp4', [1], 30, 'person', late.signal, native))
        .resolves.toEqual({ ok: false, code: 'cancelled' });
    expect(mockDelete).toHaveBeenCalledWith(uri);
});

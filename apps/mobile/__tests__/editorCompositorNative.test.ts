import { createNativeEditorCompositor } from '../src/lib/editorCompositorNative';
import { CANONICAL_EDITOR_COMPOSITOR_CAPABILITIES, type EditorCompositorFrame } from '../src/lib/editorLocalExport';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const frame = { index: 0, timestampUs: 0, width: 640, height: 360, plan: { frame: 0, referenceSize: { width: 1280, height: 720 },
    background: '#000000', visuals: [], texts: [], capabilities: { exact: true, requirements: [], unsupported: [] } } } as EditorCompositorFrame;
const native = () => ({ capabilities: jest.fn(async () => ({ ok: true, platform: 'ios', protocolVersion: 2, features: CANONICAL_EDITOR_COMPOSITOR_CAPABILITIES })),
    discardFrames: jest.fn(),
    renderFrame: jest.fn(async () => ({ ok: true, version: 1, uri: 'file:///cache/vx-frame-1.rgba', index: 0, timestampUs: 0,
        byteLength: 640 * 360 * 4, width: 640, height: 360, stride: 640 * 4, pixelFormat: 'rgba8', colorSpace: 'srgb' })) });

test('passes one canonical plan to the native compositor and validates the S9 descriptor', async () => {
    const module = native(), render = createNativeEditorCompositor('account', 'project', { media: 'file:///documents/source.mp4' }, module);
    await expect(render(frame, new AbortController().signal)).resolves.toMatchObject({ index: 0, width: 640, height: 360, pixelFormat: 'rgba8' });
    expect(module.renderFrame).toHaveBeenCalledWith('account', 'project', expect.stringMatching(/^compositor-/), expect.stringMatching(/^frame-/),
        expect.stringContaining('"referenceSize"'), { media: 'file:///documents/source.mp4' }, 640, 360, 0, 0);
});

test('fails closed for missing modules, remote sources and malformed native output', async () => {
    await expect(createNativeEditorCompositor('account', 'project', {}, null)(frame, new AbortController().signal)).rejects.toThrow('module-missing');
    await expect(createNativeEditorCompositor('account', 'project', { media: 'https://example.test/source.mp4' }, native())(frame, new AbortController().signal)).rejects.toThrow('invalid-input');
    const bad = native(); bad.renderFrame.mockResolvedValueOnce({ ok: true, version: 1, uri: 'file:///cache/vx-frame-1.rgba', index: 1, timestampUs: 0,
        byteLength: 1, width: 640, height: 360, stride: 2560, pixelFormat: 'rgba8', colorSpace: 'srgb' });
    await expect(createNativeEditorCompositor('account', 'project', {}, bad)(frame, new AbortController().signal)).rejects.toThrow('write-failed');
});

test('discards a frame which completes after the caller aborts', async () => {
    const controller = new AbortController(), module = native();
    module.renderFrame.mockImplementationOnce(async () => { controller.abort(); return { ok: true, version: 1,
        uri: 'file:///cache/vx-frame-late.rgba', index: 0, timestampUs: 0, byteLength: 640 * 360 * 4,
        width: 640, height: 360, stride: 640 * 4, pixelFormat: 'rgba8', colorSpace: 'srgb' }; });
    await expect(createNativeEditorCompositor('account', 'project', {}, module)(frame, controller.signal))
        .rejects.toMatchObject({ name: 'AbortError' });
    expect(module.discardFrames).toHaveBeenCalledWith('account', 'project', expect.any(String), expect.any(String),
        ['file:///cache/vx-frame-late.rgba']);
});

test('native semantic masks are converted to a Core Graphics grayscale clip mask', () => {
    const compositor = readFileSync(resolve(__dirname, '../modules/editor-media/ios/VeyrnoxEditorMediaModule.swift'), 'utf8');
    const contract = readFileSync(resolve(__dirname, '../modules/editor-media/ios/EditorSemanticMaskContract.swift'), 'utf8');
    const fixture = JSON.parse(readFileSync(resolve(__dirname, '../../../tests/fixtures/editorSemanticMaskPixels.json'), 'utf8')) as { cases: unknown[] };
    expect(fixture.cases).toHaveLength(5);
    expect(compositor).toContain('let maskImage = grayMask(decodedMask)');
    expect(compositor).toContain('bitsPerComponent: 8, bitsPerPixel: 8, bytesPerRow: width');
    expect(compositor).toContain('space: CGColorSpaceCreateDeviceGray()');
    expect(compositor).toContain('CGImageAlphaInfo.none.rawValue');
    expect(compositor).toContain('EditorSemanticMaskContract.confidence');
    expect(contract).toContain('if hasAlpha { return alpha }');
    expect(contract).toContain('Double(red) * 0.2126 + Double(green) * 0.7152');
    expect(compositor).not.toContain('private static func alphaMask');
});

test('native compositor paints opted-in overlays between the subject base and person matte', () => {
    const compositor = readFileSync(resolve(__dirname, '../modules/editor-media/ios/VeyrnoxEditorMediaModule.swift'), 'utf8');
    expect(compositor).toContain('private static func subjectCompositeOrder');
    expect(compositor).toContain('result.append(.visual(index, .base))');
    expect(compositor).toContain('result.append(contentsOf: behindVisuals.map { .visual($0, .normal) })');
    expect(compositor).toContain('result.append(contentsOf: behindTexts.map { .text($0) })');
    expect(compositor).toContain('result.append(.visual(index, .foreground))');
    expect(compositor).toContain('if semantic != .base, let semanticMask = clip["semanticMask"]');
    expect(compositor).toContain('if semantic != .foreground {');
});

test('motion worker is visible to the editor-media lifecycle worker and legacy compositor audio is gone', () => {
    const compositor = readFileSync(resolve(__dirname, '../modules/editor-media/ios/VeyrnoxEditorMediaModule.swift'), 'utf8');
    const advanced = readFileSync(resolve(__dirname, '../modules/editor-media/ios/EditorAdvancedAudioMix.swift'), 'utf8');
    expect(compositor).toContain('\nfinal class EditorMotionWorker {');
    expect(compositor).not.toContain('\nprivate final class EditorMotionWorker {');
    expect(compositor).not.toContain('static func mixAudio(');
    expect(compositor).not.toContain('private static func mixClip(');
    expect(advanced).toContain('EditorAudioOutputContract.peakNormalize(&mixed)');
});

test('native colour picker presents from the Expo current controller above React Native modals', () => {
    const compositor = readFileSync(resolve(__dirname, '../modules/editor-media/ios/VeyrnoxEditorMediaModule.swift'), 'utf8');
    expect(compositor).toContain('appContext?.utilities?.currentViewController()');
    expect(compositor).toContain('session.controller.modalPresentationStyle = .pageSheet');
    expect(compositor).not.toContain('private static func topViewController()');
});

import { act } from 'react';
import { createRoot } from 'test-renderer';
import { CaptionWords } from '../src/components/editor/CaptionWords';
import { isEditorPreviewApproximate, PlaybackPreview } from '../src/components/editor/EditorPlayback';
import { createFrameStore } from '../src/components/editor/editorFrameStore';
import { emptyTimeline, type Clip, type TextClip, type Timeline } from '../src/lib/nativeEditorModel';
import { webSequenceV3 } from './fixtures/webSequenceV3';
jest.mock('../src/components/editor/EditorMediaPreview', () => ({ EditorMediaPreview: () => null }));
const item: TextClip = { id: 't1', caption: true, text: 'Hello world', start: 0, len: 60, x: .5, y: .85, size: 6,
    words: [{ text: 'Hello', start: 0, len: 30 }, { text: 'world', start: 30, len: 30 }] };
test.each(['highlight', 'karaoke', 'word', 'plain'] as const)('preview %s matches timed spans and custom colour', async mode => {
    const root = createRoot(); (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    await act(async () => root.render(<CaptionWords item={{ ...item, words: mode === 'plain' ? [] : item.words,
        wordStyle: { mode: mode === 'plain' ? 'highlight' : mode, color: '#00ffff' } }} frame={35} />));
    const spans = root.container.queryAll(n => n.props.style?.color === '#00ffff');
    const text = spans.map(n => n.children.join('')).filter(Boolean);
    expect(text).toEqual(mode === 'karaoke' ? ['Hello', 'world'] : mode === 'plain' ? [] : ['world']);
    await act(async () => root.unmount());
});
test('word mode between words renders nothing', async () => {
    const root = createRoot(); await act(async () => root.render(<CaptionWords item={{ ...item, wordStyle: { mode: 'word', color: '#ffffff' } }} frame={90} />));
    expect(root.container.children).toHaveLength(0); await act(async () => root.unmount());
});
test.each(['highlight', 'karaoke', 'word'] as const)('playback routes %s timing through the overlay and hides inactive text', async mode => {
    const root = createRoot(); (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    const timeline = webSequenceV3(), store = createFrameStore(135);
    timeline.text = [{ ...item, start: 100, wordStyle: { mode, color: '#00ffff' } }];
    try {
        await act(async () => root.render(<PlaybackPreview frameStore={store} timeline={timeline}
            api={{ request: jest.fn() }} playing={false} localMediaUris={{}} />));
        const highlighted = () => root.container.queryAll(n => n.props.style?.color === '#00ffff')
            .map(n => n.children.join('')).filter(Boolean);
        expect(highlighted()).toEqual(mode === 'karaoke' ? ['Hello', 'world'] : ['world']);
        await act(async () => store.set(100));
        expect(highlighted()).toEqual(['Hello']);
        for (const frame of [99, 160]) {
            await act(async () => store.set(frame));
            expect(highlighted()).toEqual([]);
            expect(root.container.queryAll(n => n.children.includes(item.text) && !!n.props.style)).toHaveLength(0);
        }
    } finally { await act(async () => root.unmount()); }
});

const fidelityTimeline = (): Timeline => ({ ...emptyTimeline(), media: { visual: { id: 'visual', kind: 'image', frames: 90, hasAudio: false } },
    video: [{ id: 'v1', mediaId: 'visual', start: 0, in: 0, len: 90, trackId: 'video-0' } as Clip] });

test('plain single-layer frames stay exact and inactive or hidden edits do not raise the approximation indicator', () => {
    const timeline = fidelityTimeline();
    expect(isEditorPreviewApproximate(timeline, 15)).toBe(false);
    timeline.video.push({ ...timeline.video[0], id: 'later', start: 100, effect: { type: 'tiles', intensity: 1 } });
    timeline.tracks.push({ id: 'video-hidden', kind: 'video', name: 'Hidden', locked: false, muted: false, hidden: true });
    timeline.video.push({ ...timeline.video[0], id: 'hidden', trackId: 'video-hidden', mask: 'circle' });
    expect(isEditorPreviewApproximate(timeline, 15)).toBe(false);
});

test('the legacy preview reports overlapping visible layers instead of showing one as exact', () => {
    const timeline = fidelityTimeline();
    timeline.tracks.push({ id: 'video-1', kind: 'video', name: 'Overlay', locked: false, muted: false, hidden: false });
    timeline.video.push({ ...timeline.video[0], id: 'overlay', trackId: 'video-1' });
    expect(isEditorPreviewApproximate(timeline, 15)).toBe(true);
});

test.each([
    ['transition outside a canonical overlap', { transition: 20 }, false],
    ['effect', { effect: { type: 'tiles', intensity: 1 } }, true],
    ['mask', { mask: 'circle' }, true],
    ['blend', { blend: 'screen' }, true],
    ['crop', { crop: { x: .1, y: 0, width: .9, height: 1 } }, true],
    ['background', { background: { type: 'solid', color: '#123456', blur: 0, mediaId: '' } }, true],
    ['smart picture', { smartPicture: { denoise: .5, keyEnabled: false, keyColor: '#00ff00', keyTolerance: .12, keyFeather: .1, despill: .5,
        light: 0, lightX: .5, lightY: .5, lightRadius: .6 } }, true],
    ['filter', { filter: { brightness: 1.2 } }, true],
    ['animated parameters', { parameterKeyframes: [{ frame: 0, brightness: 1.2 }] }, true],
    ['transform-only animation', { animation: { in: 'fade', duration: 10 } }, false],
    ['wipe animation reveal', { animation: { in: 'wipe-left', duration: 10 } }, true],
] as const)('%s follows the canonical preview capability report', (_name, patch, expected) => {
    const timeline = fidelityTimeline(); Object.assign(timeline.video[0], patch);
    expect(isEditorPreviewApproximate(timeline, 5)).toBe(expected);
});

test('unsupported active text and audible audio surface the accessible approximation status', async () => {
    const timeline = fidelityTimeline(), store = createFrameStore(15);
    timeline.text = [{ ...item, id: 'visible', start: 0, trackId: 'text-0' }];
    timeline.media.sound = { id: 'sound', kind: 'audio', frames: 60, hasAudio: true };
    timeline.audio = [{ id: 'a1', mediaId: 'sound', start: 0, in: 0, len: 60, trackId: 'audio-0' }];
    expect(isEditorPreviewApproximate(timeline, 15)).toBe(true);
    const root = createRoot();
    try {
        await act(async () => root.render(<PlaybackPreview frameStore={store} timeline={timeline}
            api={{ request: jest.fn() }} playing={false} localMediaUris={{}} />));
        const status = root.container.queryAll(node => node.children.includes('Approximate preview'));
        expect(status).toHaveLength(1);
        expect(status[0].props).toMatchObject({ accessibilityLiveRegion: 'polite', allowFontScaling: true });
        expect(status[0].props.maxFontSizeMultiplier).toBeGreaterThanOrEqual(1.5);
    } finally { await act(async () => root.unmount()); }
});

test('hidden and soloed-away unsupported layers do not make an otherwise exact frame approximate', () => {
    const timeline = fidelityTimeline();
    timeline.tracks.find(track => track.id === 'video-0')!.solo = true;
    timeline.media.sound = { id: 'sound', kind: 'audio', frames: 60, hasAudio: true };
    timeline.audio = [{ id: 'a1', mediaId: 'sound', start: 0, in: 0, len: 60, trackId: 'audio-0' }];
    timeline.text = [{ ...item, start: 0, trackId: 'text-0' }];
    timeline.tracks.find(track => track.id === 'text-0')!.hidden = true;
    expect(isEditorPreviewApproximate(timeline, 15)).toBe(false);
});

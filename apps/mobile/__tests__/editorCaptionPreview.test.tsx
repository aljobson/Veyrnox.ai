import { act } from 'react';
import { createRoot } from 'test-renderer';
import { CaptionWords } from '../src/components/editor/CaptionWords';
import { PlaybackPreview } from '../src/components/editor/EditorPlayback';
import { createFrameStore } from '../src/components/editor/editorFrameStore';
import type { TextClip } from '../src/lib/nativeEditorModel';
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
test.each(['highlight', 'karaoke', 'word'] as const)('playback routes %s timing through the overlay and keeps the fallback text', async mode => {
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
            expect(root.container.queryAll(n => n.children.includes(item.text) && !!n.props.style).length).toBeGreaterThan(0);
        }
    } finally { await act(async () => root.unmount()); }
});

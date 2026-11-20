import { act } from 'react';
import { createRoot } from 'test-renderer';
import { CaptionWords } from '../src/components/editor/CaptionWords';
import type { TextClip } from '../src/lib/nativeEditorModel';
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

import { act } from 'react';
import { createRoot } from 'test-renderer';
import { PlaybackPreview } from '../src/components/editor/EditorPlayback';
import { createFrameStore } from '../src/components/editor/editorFrameStore';
import { emptyTimeline, type Timeline } from '../src/lib/nativeEditorModel';

const mockLoad = jest.fn();
jest.mock('../src/lib/editorStaticPreviewSources', () => ({
    createEditorStaticPreviewSourceLoader: () => ({ load: mockLoad, cancel: jest.fn(), dispose: jest.fn() }),
    editorStaticPreviewSourceKey: () => 'source-key',
}));
jest.mock('@shopify/react-native-skia', () => { throw new Error('native module unavailable'); });
jest.mock('../src/components/editor/EditorMediaPreview', () => ({
    EditorMediaPreview: () => require('react').createElement(require('react-native').View,
        { testID: 'legacy-editor-preview', accessibilityLabel: 'Legacy preview' }),
}));

function timeline(): Timeline {
    const value = emptyTimeline();
    value.media.image = { id: 'image', kind: 'image', frames: 90, width: 640, height: 360, hasAudio: false };
    value.video = [{ id: 'v1', mediaId: 'image', start: 0, in: 0, len: 90, trackId: 'video-0',
        crop: { x: .1, y: 0, width: .9, height: 1 } }];
    return value;
}

beforeEach(() => { jest.clearAllMocks(); (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; });

test('keeps the accessible legacy preview when the native Skia module is unavailable', async () => {
    const root = createRoot();
    try {
        await act(async () => root.render(<PlaybackPreview staticPreview frameStore={createFrameStore(5)} timeline={timeline()}
            api={{ request: jest.fn() }} playing={false} localMediaUris={{ image: 'file://image.png' }} />));
        const surface = root.container.queryAll(node => node.props.testID === 'editor-static-preview-surface')[0];
        await act(async () => surface.props.onLayout({ nativeEvent: { layout: { width: 320, height: 180 } } }));
        expect(mockLoad).not.toHaveBeenCalled();
        expect(root.container.queryAll(node => node.props.testID === 'legacy-editor-preview')).toHaveLength(1);
        expect(root.container.queryAll(node => node.props.testID === 'editor-static-preview-canvas')).toHaveLength(0);
        expect(root.container.queryAll(node => node.props.accessibilityLabel === 'Legacy preview')).toHaveLength(1);
        expect(root.container.queryAll(node => node.children.includes('Approximate preview'))).toHaveLength(1);
    } finally { await act(async () => root.unmount()); }
});

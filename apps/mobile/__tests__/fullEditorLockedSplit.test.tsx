jest.mock('../src/lib/voiceoverRecorder', () => ({ VOICEOVER_AVAILABLE: false }));
import { act } from 'react';
import { createRoot, type Root } from 'test-renderer';
import { FullEditorScreen } from '../src/components/editor/FullEditorScreen';
import { emptyTimeline } from '../src/lib/nativeEditorModel';
import { envelope } from './fixtures/webSequenceV3';
import { t } from '../src/lib/i18n';

const projectId = '11111111-1111-1111-1111-111111111111';
const document = { schema_version: 1 as const, project_id: projectId, brief: 'Opening scene', canvas: { aspect_ratio: '16:9', frame_rate: 30 } };
let serverDocument: any = document;
const mockRouter = { back: jest.fn(), push: jest.fn(), replace: jest.fn() };
const mockBeginSessionTask = () => ({ current: () => true });
const mockRequest = jest.fn();
const mockApi = { request: mockRequest };
let mockSession: ReturnType<typeof import('../src/components/editor/useFullEditorSession').useFullEditorSession>;
jest.mock('../src/components/editor/useFullEditorSession', () => ({ useFullEditorSession: (args: any) => {
    mockSession = jest.requireActual('../src/components/editor/useFullEditorSession').useFullEditorSession(args); return mockSession;
} }));

jest.mock('../src/lib/appCache', () => ({ getCacheUser: () => 'owner', subscribeCacheUser: () => () => {} }));
jest.mock('../src/lib/editorDrafts', () => ({ readDraft: jest.fn().mockResolvedValue(null), writeDraft: jest.fn().mockResolvedValue(true), removeDraft: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../src/lib/editorDeviceMedia', () => ({ editorDeviceMedia: { hydrate: jest.fn().mockResolvedValue({}), copy: jest.fn().mockResolvedValue(null), backup: jest.fn().mockResolvedValue(null) } }));
jest.mock('../src/lib/editorMediaDuration', () => ({ probeDuration: jest.fn().mockResolvedValue(4) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'native-save-key' }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn().mockResolvedValue('seen'), setItemAsync: jest.fn().mockResolvedValue(undefined) }));
jest.mock('expo-router', () => ({ Stack: { Screen: ({ options }: any) => options?.headerRight?.() ?? null }, usePreventRemove: () => () => {}, useRouter: () => mockRouter }));
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ api: mockApi, beginSessionTask: mockBeginSessionTask }) }));
jest.mock('../src/components/editor/EditorMediaPreview', () => ({ EditorMediaPreview: () => null }));

let root: Root;
const visible = (text: string) => root.container.queryAll((node) => node.children.includes(text)).length > 0;
const puts = () => mockRequest.mock.calls.filter(([, init]) => init?.method === 'PUT');
async function press(label: string) {
    const nodes = root.container.queryAll((node) => node.props.accessibilityLabel === label && typeof node.props.onClick === 'function');
    expect(nodes).toHaveLength(1);
    await act(async () => nodes[0].props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 }));
}

beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockRequest.mockImplementation(async (path: string, init?: RequestInit) => {
        if (init?.method === 'PUT') return { revision: JSON.parse(init.body as string).expected_revision + 1 };
        if (path.endsWith('/media-info')) return { seconds: 4 };
        if (path.endsWith('/document')) return { revision: 4, document: serverDocument };
        return { project: { id: projectId, workspace_id: 'workspace', name: 'Native cut' } };
    });
    serverDocument = document;
    root = createRoot();
});

afterEach(async () => {
    await act(async () => root.unmount());
    jest.useRealTimers();
});

test.each([0, 30])('split on a locked track reports the lock before checking frame %s', async frame => {
    const timeline = emptyTimeline();
    timeline.seq = 1; timeline.tracks[0].locked = true;
    timeline.media.m = { id: 'm', kind: 'video', name: 'Scene', frames: 60 };
    timeline.video = [{ id: 'v1', mediaId: 'm', start: 0, in: 0, len: 60, trackId: 'video-0' }];
    serverDocument = { ...envelope(timeline), project_id: projectId };
    await act(async () => root.render(<FullEditorScreen projectId={projectId} startAdvanced />));
    await act(async () => { mockSession.setSelection({ track: 'video', id: 'v1' }); mockSession.setFrame(frame); });
    await press(t('editor.split'));
    expect(visible(t('editor.unlockoraddatrackfirst', { value1: 'video' }))).toBe(true);
    expect(visible(t('editor.movetheplayheadinsidetheselectedclip'))).toBe(false);
    expect(root.container.queryAll(node => node.props.testID === 'clip-v1')).toHaveLength(1);
    expect(root.container.queryAll(node => node.props.testID === 'clip-v2')).toHaveLength(0);
    await act(async () => jest.advanceTimersByTimeAsync(900)); expect(puts()).toHaveLength(0);
});

import { act, useState } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import { SourcePicker } from '../src/components/SourcePicker';
import { t, plural } from '../src/lib/i18n';
import { launchImageLibraryAsync } from 'expo-image-picker';
import { uploadSource } from '../src/lib/uploads';
import type { GenerationReference } from '../src/lib/sources';

jest.mock('../src/lib/appCache', () => ({ ...jest.requireActual('../src/lib/appCache'), getCacheUser: () => 'A', subscribeCacheUser: () => () => {} }));
jest.mock('expo-image', () => ({ Image: jest.requireActual('react-native').Image }));
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn(), UIImagePickerPreferredAssetRepresentationMode: { Compatible: 'compatible' } }));
jest.mock('../src/lib/uploads', () => ({ uploadSource: jest.fn(), uploadMessage: () => 'Upload failed' }));
jest.mock('../src/lib/reframePicked', () => ({
    reframePicked: jest.fn(async (file: { uri: string }) => ({ ...file, uri: 'file:///cache/framed.jpg', size: 99, framed: true })),
    discardFramed: jest.fn(),
}));
void [RN.View, RN.Text, RN.Pressable, RN.ScrollView, RN.Image, RN.ActivityIndicator];

let root: Root;
let setFrame!: (frame: string) => void;
let latest: GenerationReference[] = [];
const slot = { slot: 'image', kind: 'image', label: 'Start frame', required: true, maxFiles: 1 } as const;

// The Create form: it holds the references, and hands the picker a NEW filtered array on every render.
function Form() {
    const [frame, setFrameState] = useState('');
    const [references, setReferences] = useState<GenerationReference[]>([]);
    setFrame = setFrameState;
    latest = references;
    return <SourcePicker slot={slot} api={{} as any} frame={frame} references={references.filter(ref => ref.slot === 'image')}
        onReferences={files => setReferences(files as GenerationReference[])} onChange={() => {}} onBusy={() => {}} />;
}
const renderedText = () => root.container.queryAll(n => typeof n.props.children === 'string').map(n => n.props.children).join('\n');

beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    jest.clearAllMocks();
    root = createRoot();
    let n = 0;
    jest.mocked(uploadSource).mockImplementation(async () => `key${++n}`);
    jest.mocked(launchImageLibraryAsync).mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///photo.jpg', mimeType: 'image/jpeg', fileSize: 500, width: 900, height: 1600 }] } as any);
});
afterEach(async () => { await act(async () => root.unmount()); });

async function pickPhoto() {
    const button = root.container.queryAll(n => n.props.accessibilityLabel === 'Choose image for Start frame')[0];
    await act(async () => button.props.onClick({ nativeEvent: {}, target: 1, currentTarget: 1 }));
}

test('changing the frame after a pick re-uploads into the same row: one reference, no extra row, no over-limit alert', async () => {
    await act(async () => root.render(<Form />));
    await pickPhoto();
    expect(latest).toEqual([{ slot: 'image', origin: 'upload', key: 'key1' }]);
    for (const frame of ['1:1', '9:16', '']) {
        await act(async () => setFrame(frame));
        expect(latest).toEqual([expect.objectContaining({ origin: 'upload' })]);
        expect(latest).toHaveLength(1);
        expect(renderedText()).not.toContain(plural('app.create.sources.overLimit', 1));
    }
    expect(uploadSource).toHaveBeenCalledTimes(4);
    expect(latest[0]).toMatchObject({ key: 'key4' });
});

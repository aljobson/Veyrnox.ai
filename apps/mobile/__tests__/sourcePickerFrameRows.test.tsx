import { act, useState } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import { SourcePicker } from '../src/components/SourcePicker';
import { launchImageLibraryAsync } from 'expo-image-picker';
import { uploadSource } from '../src/lib/uploads';
import { reframePicked } from '../src/lib/reframePicked';
import { replaceSlotReferences, type GenerationReference } from '../src/lib/sources';

jest.mock('../src/lib/appCache', () => ({ ...jest.requireActual('../src/lib/appCache'), getCacheUser: () => 'A', subscribeCacheUser: () => () => {} }));
jest.mock('expo-image', () => ({ Image: jest.requireActual('react-native').Image }));
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn(), UIImagePickerPreferredAssetRepresentationMode: { Compatible: 'compatible' } }));
jest.mock('../src/lib/uploads', () => ({ uploadSource: jest.fn(), uploadMessage: () => 'Upload failed' }));
jest.mock('../src/lib/reframePicked', () => ({ reframePicked: jest.fn(), discardFramed: jest.fn() }));
void [RN.View, RN.Text, RN.Pressable, RN.ScrollView, RN.Image, RN.ActivityIndicator];

// QA (Kling 3.0 frame chips): choosing another frame after a photo added a second "Start frame (optional)" row holding
// the photo's old upload, and the form then refused to generate ("accepts up to 1 file").
const slot = { slot: 'image', kind: 'image', label: 'Start frame', required: true, maxFiles: 1 } as const;
let root: Root, held: readonly GenerationReference[] = [], setFrame: (frame: string | null) => void = () => {};
// The Create screen hands the picker a fresh array on every render (references.filter(...)), exactly as here.
function Form() {
    const [refs, setRefs] = useState<readonly GenerationReference[]>([]);
    const [frame, pick] = useState<string | null>(null);
    held = refs; setFrame = pick;
    return <SourcePicker slot={slot} api={{} as any} frame={frame ?? undefined} references={refs.filter(r => r.slot === 'image')}
        onReferences={files => setRefs(all => replaceSlotReferences(all, 'image', files))} onChange={() => {}} onLibrary={() => {}} onBusy={() => {}} />;
}
const rows = () => root.container.queryAll(n => n.props.accessibilityRole === 'button' && /^Remove/.test(String(n.props.accessibilityLabel ?? '')));
beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; jest.clearAllMocks(); root = createRoot(); held = [];
    jest.mocked(launchImageLibraryAsync).mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///photo.jpg', mimeType: 'image/jpeg', fileSize: 123, width: 10, height: 20 }] } as any);
    jest.mocked(reframePicked).mockImplementation(async file => ({ ...file, uri: 'file:///square.jpg', framed: true }));
    jest.mocked(uploadSource).mockReset();
    jest.mocked(uploadSource).mockResolvedValueOnce('key-original').mockResolvedValueOnce('key-square').mockResolvedValueOnce('key-wide');
});
afterEach(async () => { await act(async () => root.unmount()); });
const uploads = () => held.flatMap(r => r.origin === 'upload' ? [r.key] : []);

test('choosing another frame after a photo replaces its upload and adds no second row', async () => {
    await act(async () => root.render(<Form />));
    const choose = root.container.queryAll(n => n.props.accessibilityLabel === 'Choose image for Start frame')[0];
    await act(async () => { choose.props.onClick({ nativeEvent: {}, target: 1, currentTarget: 1 }); });
    expect(uploads()).toEqual(['key-original']);
    await act(async () => setFrame('1:1'));
    expect(uploads()).toEqual(['key-square']);
    expect(rows()).toHaveLength(1);
    expect(root.container.queryAll(n => n.props.accessibilityLabel === 'Choose image for Start frame (optional)')).toHaveLength(0);
});

test('a second frame change still leaves one file', async () => {
    await act(async () => root.render(<Form />));
    const choose = root.container.queryAll(n => n.props.accessibilityLabel === 'Choose image for Start frame')[0];
    await act(async () => { choose.props.onClick({ nativeEvent: {}, target: 1, currentTarget: 1 }); });
    await act(async () => setFrame('1:1'));
    await act(async () => setFrame('16:9'));
    expect(uploads()).toEqual(['key-wide']);
    expect(rows()).toHaveLength(1);
});

// QA: after a model switch the held start photo showed an empty grey box that said "Ready".
test('a held photo with no local picture shows its kind, not a blank box', async () => {
    await act(async () => root.render(<SourcePicker slot={slot} api={{} as any} references={[{ slot: 'image', origin: 'upload', key: 'held' }]}
        onReferences={() => {}} onChange={() => {}} onLibrary={() => {}} onBusy={() => {}} />));
    const text = root.container.queryAll(n => typeof n.props.children === 'string').map(n => n.props.children as string);
    expect(text).toContain('▧');
});

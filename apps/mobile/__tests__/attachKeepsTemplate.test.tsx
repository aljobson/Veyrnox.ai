import { act } from 'react';
import { createRoot, type Root } from 'test-renderer';
import { AttachFromDevice } from '../src/components/AttachFromDevice';
import { t } from '../src/lib/i18n';

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ replace: mockReplace, push: jest.fn() }) }));
jest.mock('expo-image-picker', () => ({
    launchImageLibraryAsync: jest.fn(async () => ({ canceled: false, assets: [{ uri: 'file:///ref.jpg', mimeType: 'image/jpeg', fileName: 'ref.jpg', fileSize: 1000, width: 800, height: 800 }] })),
    MediaTypeOptions: { All: 'All' },
    UIImagePickerPreferredAssetRepresentationMode: { Compatible: 'compatible' },
}));
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('../src/lib/media', () => ({ ...jest.requireActual('../src/lib/media'), fetchCatalog: jest.fn(async () => []) }));
jest.mock('../src/lib/attachModel', () => ({ planAttachments: jest.fn((_all: unknown, current: { id: string }, picked: { kind: string }[]) => ({ model: current, assignments: picked.map((item) => ({ slot: 'image', item })), unused: [] })) }));
jest.mock('../src/lib/sources', () => ({ ...jest.requireActual('../src/lib/sources'), checkPicked: () => ({ ok: true, contentType: 'image/jpeg' }) }));
jest.mock('../src/lib/uploads', () => ({ uploadSource: jest.fn(async () => 'upload-1'), uploadMessage: () => 'failed' }));
jest.mock('../src/lib/creativeSourceHandoff', () => ({ stageCreativeSourceHandoff: jest.fn(() => 'handoff-1') }));

let root: Root;
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; root = createRoot(); mockReplace.mockReset(); });
afterEach(async () => { await act(async () => root.unmount()); });

const press = async () => {
    const buttons = root.container.queryAll((n) => n.props.accessibilityRole === 'button' && typeof n.props.onClick === 'function');
    await act(async () => buttons[0]!.props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 }));
};

test('attaching a picture keeps the template prompt and template details in the reopened form', async () => {
    const carry = { prompt: 'Exact community prompt with [reference]', tid: 'genjutsu-1', tneeds: 'image', duration: '5', aspect: '9:16' };
    await act(async () => root.render(<AttachFromDevice api={{} as any} current={{ id: 'model-a' } as any} carry={carry} />));
    await press();
    expect(mockReplace).toHaveBeenCalledTimes(1);
    const { params } = mockReplace.mock.calls[0][0];
    expect(params).toMatchObject({ ...carry, modelId: 'model-a', recipe: 'attach', sourceHandoff: 'handoff-1' });
});

test('without anything to carry the reopened form gets only the model and files, as before', async () => {
    await act(async () => root.render(<AttachFromDevice api={{} as any} current={{ id: 'model-a' } as any} />));
    await press();
    expect(mockReplace.mock.calls[0][0].params).toEqual({ modelId: 'model-a', recipe: 'attach', sourceHandoff: 'handoff-1' });
    expect(t('attachFromDevice.attachfromdevice')).toBeTruthy();
});

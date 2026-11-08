import { act } from 'react';
import { createRoot, type Root } from 'test-renderer';
import { AttachFromDevice } from '../src/components/AttachFromDevice';
import { t } from '../src/lib/i18n';

const mockReplace = jest.fn();
const noPictures = { id: 'seedance-fast', name: 'Seedance 2.0 (Fast)' };
const reference = { id: 'seedance-2.0-reference', name: 'Seedance 2.0 Reference' };
jest.mock('expo-router', () => ({ useRouter: () => ({ replace: mockReplace, push: jest.fn() }) }));
jest.mock('expo-image-picker', () => ({
    launchImageLibraryAsync: jest.fn(async () => ({ canceled: false, assets: [{ uri: 'file:///me.jpg', mimeType: 'image/jpeg', fileSize: 1000 }] })),
    UIImagePickerPreferredAssetRepresentationMode: { Compatible: 'compatible' },
}));
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('../src/lib/media', () => ({ ...jest.requireActual('../src/lib/media'), fetchCatalog: jest.fn(async () => []) }));
jest.mock('../src/lib/attachModel', () => ({ planOpenForm: jest.fn(() => null), planAttachments: jest.fn() }));
jest.mock('../src/lib/sources', () => ({ ...jest.requireActual('../src/lib/sources'), checkPicked: () => ({ ok: true, contentType: 'image/jpeg' }) }));
jest.mock('../src/lib/uploads', () => ({ uploadSource: jest.fn(async () => 'upload-1'), uploadMessage: () => 'failed', isConsentDeclined: () => false }));
jest.mock('../src/lib/creativeSourceHandoff', () => ({ stageCreativeSourceHandoff: jest.fn(() => 'handoff-1') }));

let root: Root;
beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; root = createRoot(); mockReplace.mockReset();
    const { planAttachments } = require('../src/lib/attachModel');
    planAttachments.mockImplementation((_all: unknown, _cur: unknown, items: unknown[]) => ({ model: reference, assignments: items.map(item => ({ slot: 'image', item })), unused: [] }));
});
afterEach(async () => { await act(async () => root.unmount()); });

const buttons = () => root.container.queryAll((n) => n.props.accessibilityRole === 'button' && typeof n.props.onClick === 'function');
const click = (node: { props: Record<string, any> }) => act(async () => { await node.props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 }); });
const mount = () => act(async () => root.render(<AttachFromDevice api={{} as any} current={noPictures as any} onPlaced={jest.fn()} carry={{ prompt: 'template words', tid: 'epic-train' }} />));

test('the card no longer promises a silent move to another model', () => {
    expect(t('attachFromDevice.pickseveralpicturesvideosoraudiofiles')).not.toMatch(/we move you/i);
});

test('a model with no slot for the file names itself and the model that takes it, and does not switch on its own', async () => {
    await mount();
    await click(buttons()[0]!);
    expect(mockReplace).not.toHaveBeenCalled();
    expect(root.container.queryAll(n => n.children.includes(t('attachFromDevice.nomodeltakesthosefilesrightnow')))).toHaveLength(0);
    const said = root.container.queryAll(n => n.children.includes(t('attachFromDevice.modelTakesNoFiles', { value1: noPictures.name, value2: reference.name })));
    expect(said.length).toBeGreaterThan(0);
    // Reference refuses real-person photos: its likeness notice is shown with the offer.
    expect(root.container.queryAll(n => n.children.includes(t('app.create.referenceLikenessNotice'))).length).toBeGreaterThan(0);
});

test('tapping Switch to <model> reopens Create on that model, keeping the template and prompt', async () => {
    await mount();
    await click(buttons()[0]!);
    const label = t('attachFromDevice.switchTo', { value1: reference.name });
    const sw = root.container.queryAll(n => n.props.accessibilityRole === 'button' && typeof n.props.onClick === 'function' && JSON.stringify(n.children).includes(label));
    expect(sw.length).toBeGreaterThan(0);
    await click(sw[0]!);
    expect(mockReplace).toHaveBeenCalledTimes(1);
    expect(mockReplace.mock.calls[0][0].params).toMatchObject({ modelId: reference.id, prompt: 'template words', tid: 'epic-train', switched: '1' });
});

test('with no model that takes the files, the plain refusal stays', async () => {
    require('../src/lib/attachModel').planAttachments.mockImplementation(() => null);
    await mount();
    await click(buttons()[0]!);
    expect(root.container.queryAll(n => n.children.includes(t('attachFromDevice.nomodeltakesthosefilesrightnow'))).length).toBeGreaterThan(0);
});

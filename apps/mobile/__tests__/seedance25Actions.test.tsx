import { act } from 'react';
import { createRoot, type Root } from 'test-renderer';
import { Seedance25Actions } from '../src/components/Seedance25Actions';
import { t } from '../src/lib/i18n';
import type { CatalogModel } from '../src/lib/media';
const mockRequest = jest.fn(), mockPush = jest.fn();
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ api: { request: mockRequest } }) }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'stable-request-key' }));
jest.mock('../src/lib/appCache', () => ({ getCacheUser: () => 'owner' }));
jest.mock('../src/lib/media', () => ({ fetchAllCatalog: jest.fn() }));
jest.mock('../src/lib/uploads', () => ({ uploadSource: jest.fn(), putFromDisk: jest.fn() }));
jest.mock('../src/components/ui', () => {
    const React = require('react'), RN = require('react-native');
    return {
        Text: RN.Text,
        TextField: (p: Record<string, unknown>) => React.createElement(RN.TextInput, p),
        Button: ({ label, onPress, ...props }: Record<string, unknown>) => React.createElement(RN.Pressable, { ...props, accessibilityRole: 'button', accessibilityLabel: label, onPress }, React.createElement(RN.Text, null, label)),
        themedStyles: (f: () => unknown) => f(), useThemedStyles: (s: unknown) => s,
    };
});
const model: CatalogModel = { id: 'seedance-2.5-edit', name: 'Restyle clip', modality: 'video-to-video', credits: 76, gated: false, durations: [5], capabilities: { media: { video: { required: true, maxFiles: 1 } } } };
let root: Root;
beforeEach(() => { (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true; jest.clearAllMocks(); root = createRoot(); });
afterEach(async () => { await act(async () => root.unmount()); });
function button(key: string) { return root.container.queryAll(n => n.props.accessibilityRole === 'button' && n.props.accessibilityLabel === t(key)); }
test('no catalog offer or gated placeholder means no action', async () => {
    await act(async () => root.render(<Seedance25Actions models={[{ ...model, gated: true }]} assetId="asset" />));
    expect(button('app.seedance25.edit')).toHaveLength(0);
});
test.each(['edit','extend'])('%s: measured quote confirms exact price, submitted offers show no cancel control', async task => {
    const offer={...model,id:`seedance-2.5-${task}`,credits:task==='edit'?76:78};
    const credits=task==='edit'?152:78;
    mockRequest.mockImplementation((path: string) => Promise.resolve(path.endsWith('/quote')
        ? { model_id: offer.id, credits, units: task==='edit'?2:1, source_seconds: 5.055 } : { job_id: 'accepted-job' }));
    await act(async () => root.render(<Seedance25Actions models={[offer]} assetId="asset" />));
    await act(async () => button(`app.seedance25.${task}`)[0].props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 }));
    const fields = root.container.queryAll(n => typeof n.props.onChangeText === 'function');
    await act(async () => fields[0].props.onChangeText('Turn the sky gold'));
    await act(async () => button('app.seedance25.quote')[0].props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 }));
    expect(mockRequest.mock.calls[0][0]).toBe('/api/v1/generations/quote');
    await act(async () => button('app.seedance25.confirm')[0].props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 }));
    const sent = JSON.parse(mockRequest.mock.calls[1][1].body);
    expect(sent.confirmed_credits).toBe(credits);
    expect(sent.inputs).toEqual({ prompt: 'Turn the sky gold' });
    expect(sent.references).toEqual([{ slot: 'video', origin: 'asset', asset_id: 'asset' }]);
    expect(root.container.queryAll(n => n.props.accessibilityRole === 'button')).toHaveLength(1);
    expect(button('app.seedance25.result')).toHaveLength(1);
    await act(async () => button('app.seedance25.result')[0].props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 }));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/job/[id]', params: { id: 'accepted-job' } });
});

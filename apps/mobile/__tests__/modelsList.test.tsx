import { act } from 'react';
import * as RN from 'react-native';
import { createRoot } from 'test-renderer';
import Models from '../src/app/(app)/models';
const mockHref = jest.fn();
jest.mock('expo-router', () => ({ Stack: { Screen: () => null }, Link: ({ href, children }: any) => { mockHref(href); return children; } }));
jest.mock('../src/components/CatalogList', () => ({ kindTitleKey: () => 'catalog.kind.image', CatalogList: ({ render }: any) => render({ kind: 'image', models: [{ id: 'm/1', name: 'Image', modality: 'text-to-image', credits: 7, durations: [], capabilities: { inputs: { prompt: {} } } }] }) }));
void [RN.View, RN.Text, RN.Pressable];
test('model rows link to an encoded model detail route', async () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    const root = createRoot();
    try { await act(async () => root.render(<Models />)); expect(mockHref).toHaveBeenCalledWith('/model/m%2F1'); }
    finally { await act(async () => root.unmount()); }
});

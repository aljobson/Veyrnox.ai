import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import { AudioTemplateCard } from '../src/components/templates/AudioTemplateCard';
import { UploadLimitNote } from '../src/components/create/AttachMore';
import { chooseLocale } from '../src/lib/i18n';
import type { CatalogModel } from '../src/lib/media';

void [RN.View, RN.Text, RN.Pressable];
let root: Root;
const text = () => root.container.queryAll(n => typeof n.props.children === 'string').map(n => n.props.children).join('\n');
const all = () => root.container.queryAll(n => Array.isArray(n.props.children) || typeof n.props.children === 'string')
    .map(n => [n.props.children].flat().filter(c => typeof c === 'string' || typeof c === 'number').join('')).join('\n');
const template = { id: 'a1', name: 'Lo-fi loop', category: 'music', modelId: 'music-model', prompt: 'A calm lo-fi loop' };
const imageModel = (maxFiles: number): CatalogModel => ({
    id: 'm', name: 'M', modality: 'image-to-image', credits: 3, gated: false, durations: [],
    capabilities: { inputs: {}, media: { image: { required: true, maxFiles } } },
});
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; root = createRoot(); });
afterEach(async () => { await act(async () => root.unmount()); chooseLocale('en'); });

test('an audio template card shows its catalog price, like a video card', async () => {
    await act(async () => root.render(<AudioTemplateCard template={template} credits={3} onOpen={jest.fn()} />));
    expect(text()).toContain('3 credits');
    expect(root.container.queryAll(n => n.props.accessibilityLabel === 'Audio, Lo-fi loop, 3 credits').length).toBeGreaterThan(0);
});

test('an audio template whose model is not in the catalog shows no price', async () => {
    await act(async () => root.render(<AudioTemplateCard template={template} onOpen={jest.fn()} />));
    expect(text()).not.toContain('credit');
});

test.each([[1, 'Up to 1 file.'], [2, 'Up to 2 files.']])('the upload limit for %i reads %s', async (n, words) => {
    await act(async () => root.render(<UploadLimitNote model={imageModel(n)} />));
    expect(all()).toContain(words);
});

test('the upload limit uses each language’s plural forms', async () => {
    chooseLocale('ru');
    await act(async () => root.render(<UploadLimitNote model={imageModel(2)} />));
    expect(all()).toContain('До 2 файлов');
});

import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import { AudioTemplateCard } from '../src/components/templates/AudioTemplateCard';
import { UploadLimitNote } from '../src/components/create/AttachMore';
import { chooseLocale } from '../src/lib/i18n';
import type { CatalogModel } from '../src/lib/media';

jest.mock('expo-image', () => ({ Image: 'ArtImage' }));
const mockPlay = jest.fn();
let mockFinished = false;
jest.mock('expo-audio', () => ({
    setAudioModeAsync: jest.fn(() => Promise.resolve()),
    useAudioPlayer: () => ({ play: mockPlay }),
    useAudioPlayerStatus: () => ({ didJustFinish: mockFinished }),
}));

void [RN.View, RN.Text, RN.Pressable];
let root: Root;
const text = () => root.container.queryAll(n => typeof n.props.children === 'string').map(n => n.props.children).join('\n');
const all = () => root.container.queryAll(n => Array.isArray(n.props.children) || typeof n.props.children === 'string')
    .map(n => [n.props.children].flat().filter(c => typeof c === 'string' || typeof c === 'number').join('')).join('\n');
const template = { id: 'a1', name: 'Lo-fi loop', category: 'music', modelId: 'music-model', prompt: 'A calm lo-fi loop', previewUrl: null, previewAudioUrl: null };
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

test('an audio template card shows its artwork when the server sends one', async () => {
    const art = 'https://veyrnox.ai/music-licensed/a.jpg';
    await act(async () => root.render(<AudioTemplateCard template={{ ...template, previewUrl: art }} onOpen={jest.fn()} />));
    expect(root.container.queryAll(n => n.props.source?.uri === art).length).toBeGreaterThan(0);
});

test('an audio template card plays its sample from the thumbnail and opens from the rest of the row', async () => {
    const onPlay = jest.fn(), onOpen = jest.fn();
    const withSample = { ...template, previewUrl: 'https://veyrnox.ai/a.jpg', previewAudioUrl: 'https://veyrnox.ai/a.mp3' };
    mockPlay.mockClear(); mockFinished = false;
    await act(async () => root.render(<AudioTemplateCard template={withSample} onPlay={onPlay} onOpen={onOpen} />));
    const play = root.container.queryAll(n => n.props.accessibilityLabel === 'Play, Lo-fi loop' && typeof n.props.onClick === 'function')[0];
    await act(async () => play.props.onClick());
    expect(onPlay).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
    expect(mockPlay).not.toHaveBeenCalled();
    await act(async () => root.render(<AudioTemplateCard template={withSample} playing onPlay={onPlay} onOpen={onOpen} />));
    expect(root.container.queryAll(n => n.props.accessibilityLabel === 'Pause, Lo-fi loop').length).toBeGreaterThan(0);
    expect(mockPlay).toHaveBeenCalledTimes(1);
    const openRow = root.container.queryAll(n => n.props.accessibilityLabel === 'Audio, Lo-fi loop' && typeof n.props.onClick === 'function')[0];
    await act(async () => openRow.props.onClick());
    expect(onOpen).toHaveBeenCalledTimes(1);
});

test('a finished sample stops its card', async () => {
    const onPlay = jest.fn();
    mockFinished = true;
    await act(async () => root.render(<AudioTemplateCard template={{ ...template, previewAudioUrl: 'https://veyrnox.ai/a.mp3' }} playing onPlay={onPlay} onOpen={jest.fn()} />));
    expect(onPlay).toHaveBeenCalled();
    mockFinished = false;
});

test('a template without a sample shows no play button', async () => {
    await act(async () => root.render(<AudioTemplateCard template={template} onPlay={jest.fn()} onOpen={jest.fn()} />));
    expect(root.container.queryAll(n => typeof n.props.accessibilityLabel === 'string' && n.props.accessibilityLabel.startsWith('Play,')).length).toBe(0);
});

test('a finished sample stops its card once even when the card re-renders with a new handler', async () => {
    const first = jest.fn(), second = jest.fn();
    const withSample = { ...template, previewAudioUrl: 'https://veyrnox.ai/a.mp3' };
    mockFinished = true;
    await act(async () => root.render(<AudioTemplateCard template={withSample} playing onPlay={first} onOpen={jest.fn()} />));
    await act(async () => root.render(<AudioTemplateCard template={withSample} playing onPlay={second} onOpen={jest.fn()} />));
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
    mockFinished = false;
});

import { act } from 'react';
import { createRoot, type Root } from 'test-renderer';
import { JobThumb, type AssetLinks } from '../src/components/JobThumb';

jest.mock('expo-image', () => ({ Image: 'Image' }));
jest.mock('../src/lib/videoPoster', () => ({ posterFor: async () => null }));

let root: Root;
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; root = createRoot(); });
afterEach(async () => { await act(async () => root.unmount()); });

const links = (value: unknown): AssetLinks => ({ peek: () => undefined, request: async () => value, clear: () => {} }) as unknown as AssetLinks;
const text = () => root.container.queryAll(n => typeof n.props.children === 'string').map(n => n.props.children as string);

test('shows the picture itself for an image', async () => {
    await act(async () => root.render(<JobThumb links={links({ kind: 'file', url: 'https://files.test/a.png', mime: 'image/png', expiresAt: null })} jobId="j1" />));
    expect(root.container.queryAll(n => n.props.source?.uri === 'https://files.test/a.png')).toHaveLength(1);
});

test('shows a note for audio and a play mark for video, never a blank box', async () => {
    await act(async () => root.render(<JobThumb links={links({ kind: 'file', url: 'u', mime: 'audio/mpeg', expiresAt: null })} jobId="a1" />));
    expect(text()).toContain('♫');
    await act(async () => root.render(<JobThumb links={links({ kind: 'file', url: 'u', mime: 'video/mp4', expiresAt: null })} jobId="v1" />));
    expect(text()).toContain('▶');
});

test('falls back to a plain glyph when the file cannot be reached', async () => {
    await act(async () => root.render(<JobThumb links={links({ kind: 'none' })} jobId="x" />));
    expect(text()).toContain('▧');
});

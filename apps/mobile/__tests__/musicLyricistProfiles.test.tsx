import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'test-renderer';
import type { ApiClient } from '../src/lib/api';
import { MusicLyricistProfiles } from '../src/components/music/MusicLyricistProfiles';
import { ApiError } from '../src/lib/api';
import { t } from '../src/lib/i18n';
import { MUSIC_LYRICIST_INSTRUCTION_PREFIX, MUSIC_LYRICIST_NAME_PREFIX, openMusicLyricistChat } from '../src/lib/music/lyricistProfile';

const good = { id: 'p1', name: `${MUSIC_LYRICIST_NAME_PREFIX}Harbour`, instructions: `${MUSIC_LYRICIST_INSTRUCTION_PREFIX}\nPrivate`, model_id: null, thinking: false, web: false };
const request = jest.fn();
const api = { request } as unknown as ApiClient;
const opened = jest.fn();
let root: Root;
const button = (label: string) => root.container.queryAll(node => node.props.accessibilityLabel === label && typeof node.props.onClick === 'function')[0];
const field = (label: string) => root.container.queryAll(node => node.props.accessibilityLabel === label && typeof node.props.onChangeText === 'function')[0];
const click = async (label: string) => { await act(async () => button(label).props.onClick({ nativeEvent: {} })); };
const edit = async (label: string, value: string) => { await act(async () => field(label).props.onChangeText(value)); };
const mount = async (generation = 0, strict = false) => { await act(async () => root.render(strict
    ? <StrictMode><MusicLyricistProfiles api={api} lyrics="My private line" sessionGeneration={generation} onOpenChat={opened} /></StrictMode>
    : <MusicLyricistProfiles api={api} lyrics="My private line" sessionGeneration={generation} onOpenChat={opened} />)); };

jest.mock('../src/lib/music/lyricistProfile', () => ({
    ...jest.requireActual('../src/lib/music/lyricistProfile'),
    openMusicLyricistChat: jest.fn(async () => ({ ok: true, threadId: 'thread-1' })),
}));

beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    jest.clearAllMocks(); root = createRoot();
    request.mockResolvedValue({ enabled: true, personas: [good, { ...good, id: 'bad', name: 'Generic' }, { ...good, id: 'blank', name: `${MUSIC_LYRICIST_NAME_PREFIX}   ` }] });
});
afterEach(() => { act(() => root.unmount()); });

test('loads only marker-valid labelled profiles and never displays private instructions', async () => {
    await mount(); await click(t('musicLyricist.show'));
    expect(button('Harbour')).toBeDefined();
    expect(root.container.queryAll(node => node.children.includes('Private'))).toHaveLength(0);
    expect(button('Generic')).toBeUndefined();
    expect(request).toHaveBeenCalledWith('/api/v1/chat/personas');
});

test('StrictMode effect replay keeps the mounted session live', async () => {
    await mount(0, true); await click(t('musicLyricist.show'));
    expect(button('Harbour')).toBeDefined();
    expect(button(t('musicLyricist.hide')).props.accessibilityState.busy).toBe(false);
});

test('disabled capability leaves Music usable and load errors have retry', async () => {
    request.mockResolvedValueOnce({ enabled: false, personas: [] });
    await mount(); await click(t('musicLyricist.show'));
    expect(root.container.queryAll(node => node.children.includes(t('musicLyricist.unavailable')))).toHaveLength(1);
    await act(async () => root.unmount()); root = createRoot(); request.mockRejectedValueOnce(new ApiError(503, 'later'));
    await mount(); await click(t('musicLyricist.show'));
    expect(button(t('musicLyricist.retry'))).toBeDefined();
});

test('creates, selects and removes a profile with explicit ownership and confirmation', async () => {
    request.mockImplementation(async (path, init) => {
        if (path === '/api/v1/chat/personas' && init?.method === 'POST') return { persona: good };
        if (path === '/api/v1/chat/personas/p1' && init?.method === 'DELETE') return { ok: true };
        return { enabled: true, personas: [good] };
    });
    await mount(); await click(t('musicLyricist.show')); await click(t('musicLyricist.new'));
    await edit(t('musicLyricist.name'), 'Harbour'); await edit(t('musicLyricist.direction'), 'Sparse imagery'); await edit(t('musicLyricist.examples'), 'My own line');
    expect(button(t('musicLyricist.save')).props.accessibilityState.disabled).toBe(true);
    await click(t('musicLyricist.owns')); await click(t('musicLyricist.save'));
    const post = request.mock.calls.find(([, init]) => init?.method === 'POST');
    const body = JSON.parse(post![1].body);
    expect(body).toMatchObject({ name: `${MUSIC_LYRICIST_NAME_PREFIX}Harbour`, model_id: null, thinking: false, web: false });
    expect(body.instructions).toMatch(/Never reproduce a distinctive line/);
    expect(button('Harbour').props.accessibilityState.selected).toBe(true);
    await click(t('musicLyricist.delete')); expect(button(t('musicLyricist.confirmDelete'))).toBeDefined();
    await click(t('musicLyricist.confirmDelete'));
    expect(request).toHaveBeenCalledWith('/api/v1/chat/personas/p1', { method: 'DELETE' });
    expect(button('Harbour')).toBeUndefined();
});

test('shows an inline limit error for non-ASCII instructions before any save request', async () => {
    await mount(); await click(t('musicLyricist.show')); await click(t('musicLyricist.new'));
    await edit(t('musicLyricist.name'), 'Harbour'); await edit(t('musicLyricist.direction'), 'Sparse');
    await edit(t('musicLyricist.examples'), '歌'.repeat(2500)); await click(t('musicLyricist.owns'));
    expect(root.container.queryAll(node => node.children.includes(t('musicLyricist.profileTooLong')))).toHaveLength(1);
    expect(button(t('musicLyricist.save')).props.accessibilityState.disabled).toBe(true);
    expect(request.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
});

test('a successful create followed by a failed refresh closes the form and offers retry', async () => {
    request.mockImplementationOnce(async () => ({ enabled: true, personas: [] }))
        .mockImplementationOnce(async (_path, init) => init?.method === 'POST' ? { persona: good } : undefined)
        .mockRejectedValueOnce(new ApiError(503, 'later'))
        .mockResolvedValueOnce({ enabled: true, personas: [good] });
    await mount(); await click(t('musicLyricist.show')); await click(t('musicLyricist.new'));
    await edit(t('musicLyricist.name'), 'Harbour'); await edit(t('musicLyricist.direction'), 'Sparse');
    await edit(t('musicLyricist.examples'), 'Mine'); await click(t('musicLyricist.owns')); await click(t('musicLyricist.save'));
    expect(field(t('musicLyricist.name'))).toBeUndefined();
    expect(button(t('musicLyricist.retry'))).toBeDefined();
    await click(t('musicLyricist.retry'));
    expect(button('Harbour')).toBeDefined();
    expect(request.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
});

test('opens an unsent profiled Chat draft and ignores a stale account-generation load', async () => {
    let resolve!: (value: unknown) => void;
    request.mockReturnValueOnce(new Promise(r => { resolve = r; }));
    await mount(0);
    act(() => button(t('musicLyricist.show')).props.onClick({ nativeEvent: {} }));
    await mount(1);
    await act(async () => resolve({ enabled: true, personas: [good] }));
    expect(button('Harbour')).toBeUndefined();
    request.mockResolvedValue({ enabled: true, personas: [good] });
    await click(t('musicLyricist.show')); await click('Harbour');
    await edit(t('musicLyricist.request'), 'Tighten the chorus'); await click(t('musicLyricist.openChat'));
    expect(opened).toHaveBeenCalledWith('thread-1');
});

test('a session change after a committed handoff suppresses stale navigation', async () => {
    let finish!: (value: { ok: true; threadId: string }) => void;
    jest.mocked(openMusicLyricistChat).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    await mount(0); await click(t('musicLyricist.show')); await click('Harbour');
    await edit(t('musicLyricist.request'), 'Tighten the chorus');
    act(() => button(t('musicLyricist.openChat')).props.onClick({ nativeEvent: {} }));
    await mount(1);
    await act(async () => finish({ ok: true, threadId: 'thread-1' }));
    expect(opened).not.toHaveBeenCalled();
});

test('duplicate names show specific copy', async () => {
    request.mockImplementation(async (path, init) => {
        if (path === '/api/v1/chat/personas' && init?.method === 'POST') throw new ApiError(409, 'persona_exists');
        return { enabled: true, personas: [] };
    });
    await mount(); await click(t('musicLyricist.show')); await click(t('musicLyricist.new'));
    await edit(t('musicLyricist.name'), 'Harbour'); await edit(t('musicLyricist.direction'), 'Sparse'); await edit(t('musicLyricist.examples'), 'Mine'); await click(t('musicLyricist.owns')); await click(t('musicLyricist.save'));
    expect(root.container.queryAll(node => node.children.includes(t('musicLyricist.duplicate')))).toHaveLength(1);
});

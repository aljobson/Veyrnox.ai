import { act } from 'react';
import { createRoot, type Root } from 'test-renderer';
import * as DocumentPicker from 'expo-document-picker';
import { MusicOwnedSourcesCard } from '../src/components/music/MusicOwnedSourcesCard';
import { bindCacheUser, resetCacheUser } from '../src/lib/appCache';
import { listMusicSources, removeMusicSource, uploadMusicSource } from '../src/lib/music';
import { t } from '../src/lib/i18n';

jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('expo-crypto', () => ({ randomUUID: () => '11111111-1111-4111-8111-111111111111' }));
jest.mock('../src/lib/cacheFiles', () => ({ discardCacheCopy: jest.fn() }));
jest.mock('../src/lib/music', () => {
    const actual = jest.requireActual('../src/lib/music');
    return { ...actual, listMusicSources: jest.fn(), removeMusicSource: jest.fn(), uploadMusicSource: jest.fn() };
});

const pick = DocumentPicker.getDocumentAsync as jest.Mock;
const list = listMusicSources as jest.Mock;
const remove = removeMusicSource as jest.Mock;
const upload = uploadMusicSource as jest.Mock;
const api = { request: jest.fn() } as never;
const source = { id: '3f2b8c1e-5a4d-4e6f-8a9b-0c1d2e3f4a5b', filename: 'idea.wav', mime_type: 'audio/wav', size_bytes: 4096,
    duration_seconds: 12.5, status: 'ready', created_at: '2026-11-25T10:00:00Z', rights_statement_version: 'music-source-rights-v1',
    preview_url: 'https://private.example/idea.wav', preview_expires_in: 300 } as const;
let root: Root;
const button = (label: string) => root.container.queryAll(n => n.props.accessibilityRole === 'button' && n.props.accessibilityLabel === label)[0];
const control = (label: string) => root.container.queryAll(n => n.props.accessibilityLabel === label
    && typeof (n.props.onClick ?? n.props.onPress) === 'function')[0];
const click = async (label: string) => { const target = control(label); expect(target).toBeDefined();
    await act(async () => (target.props.onClick ?? target.props.onPress)({ nativeEvent: {} })); };
const text = (value: string) => root.container.queryAll(n => n.children.includes(value));

beforeEach(async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    resetCacheUser(); await bindCacheUser('source-owner'); jest.clearAllMocks(); list.mockResolvedValue([]); root = createRoot();
    await act(async () => root.render(<MusicOwnedSourcesCard api={api} />));
});
afterEach(async () => { await act(async () => { root.unmount(); resetCacheUser(); }); });

test('opens on demand, verifies rights, uploads, and removes a private source', async () => {
    await click(t('musicSources.open')); expect(list).toHaveBeenCalledWith(api);
    pick.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///idea.wav', name: 'idea.wav', size: 4096, mimeType: 'audio/x-wav' }] });
    upload.mockResolvedValue(source);
    await click(t('musicSources.rights')); await click(t('musicSources.choose'));
    expect(button(t('musicSources.upload'))).toBeDefined(); await click(t('musicSources.upload'));
    expect(upload).toHaveBeenCalledWith(api, { uri: 'file:///idea.wav', name: 'idea.wav', size: 4096, mimeType: 'audio/wav' },
        'music-source-11111111-1111-4111-8111-111111111111', expect.any(Function), expect.any(AbortSignal));
    expect(text(t('musicSources.ready'))).not.toHaveLength(0);
    remove.mockResolvedValue(undefined); await click(t('musicSources.removeNamed', { name: 'idea.wav' }));
    expect(remove).toHaveBeenCalledWith(api, source.id); expect(text(t('musicSources.removed'))).not.toHaveLength(0);
});

test('keeps the same idempotency key when an upload acknowledgement is retried', async () => {
    await click(t('musicSources.open'));
    pick.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///idea.wav', name: 'idea.wav', size: 4096, mimeType: 'audio/wav' }] });
    upload.mockRejectedValueOnce(new Error('lost acknowledgement')).mockResolvedValueOnce(source);
    await click(t('musicSources.rights')); await click(t('musicSources.choose')); await click(t('musicSources.upload')); await click(t('musicSources.upload'));
    expect(upload).toHaveBeenCalledTimes(2); expect(upload.mock.calls[0][2]).toBe(upload.mock.calls[1][2]);
});

test('an account change aborts and clears an in-flight source result', async () => {
    await click(t('musicSources.open'));
    pick.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///idea.wav', name: 'idea.wav', size: 4096, mimeType: 'audio/wav' }] });
    let finish!: (value: typeof source) => void; upload.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    await click(t('musicSources.rights')); await click(t('musicSources.choose'));
    await click(t('musicSources.upload')); await act(async () => bindCacheUser('different-owner'));
    await act(async () => finish(source));
    expect(button(t('musicSources.open'))).toBeDefined(); expect(text('idea.wav')).toHaveLength(0);
});

test('a document picked after an account change is discarded instead of crossing accounts', async () => {
    await click(t('musicSources.open')); await click(t('musicSources.rights'));
    let finish!: (value: unknown) => void; pick.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    await click(t('musicSources.choose')); await act(async () => bindCacheUser('different-owner'));
    await act(async () => finish({ canceled: false, assets: [{ uri: 'file:///late.wav', name: 'late.wav', size: 4096, mimeType: 'audio/wav' }] }));
    expect(button(t('musicSources.open'))).toBeDefined(); expect(text('late.wav')).toHaveLength(0); expect(upload).not.toHaveBeenCalled();
});

import { act } from 'react';
import { createRoot, type Root } from 'test-renderer';
import * as RN from 'react-native';
import { MusicRemixBody } from '../src/components/music/MusicRemixBody';
import { t } from '../src/lib/i18n';
import { SONG_ID, VERSION_ID } from './fixtures/musicActions';

const mockApi = { request: jest.fn() };
const mockFlow = {
    edit: jest.fn(), review: jest.fn(), confirm: jest.fn(), load: jest.fn(), refresh: jest.fn(),
    refreshBalance: jest.fn(), isLive: () => true,
};
const mockState = {
    status: 'on', song: { id: SONG_ID, version_id: VERSION_ID, title: 'First song' },
    input: { song_id: SONG_ID, version_id: VERSION_ID, rights_confirmed: true,
        parameters: { prompt: 'Warm blend', second_song_id: '', second_version_id: '', source_influence: 50 } },
    busy: false, error: 'source_duration_invalid', result: null, poll: null, balance: 100,
};

jest.mock('expo-router', () => ({ Stack: { Screen: () => null } }));
jest.mock('../src/lib/music/client', () => ({ listSongs: jest.fn(async () => []) }));
jest.mock('../src/components/music/MusicPlayer', () => ({ MusicPlayer: () => null }));
jest.mock('../src/components/music/useSongActionScreen', () => ({
    useSongActionScreen: () => ({ api: mockApi, flow: mockFlow, state: mockState, pending: null }),
}));
void [RN.View, RN.Text, RN.Pressable, RN.ScrollView, RN.TextInput];

let root: Root;
beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    root = createRoot();
});
afterEach(async () => { await act(async () => root.unmount()); });

test('Mashup shows a source-duration failure instead of hiding it with Sample controls', async () => {
    await act(async () => root.render(<MusicRemixBody id={SONG_ID} kind="mashup" />));
    const message = t('musicRemix.mashup.sourceInvalid');
    expect(root.container.queryAll(node => node.children.includes(message)).length).toBeGreaterThan(0);
});

import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import Screen from '../src/app/(app)/film/shot/[id]';
import { bindCacheUser, resetCacheUser, wipeCache } from '../src/lib/appCache';
import { getOpenedFilm, openCloudFilm } from '../src/lib/filmCloud';
import { saveStudio } from '../src/lib/filmStudioStore';
import { appCache } from '../src/lib/appCache';
declare const __dirname: string;
const { readFileSync } = require('fs'); const { resolve } = require('path');
const source = readFileSync(resolve(__dirname, '../../../app/veyrnox/_lib/filmStudio.js'), 'utf8').replace(/^export /gm, '');
const web = new Function(`${source}\nreturn { emptyFilm, SHOT_LANES, promptContext };`)();
const mockPush = jest.fn();
jest.mock('expo-router', () => ({ Stack: { Screen: () => null }, useLocalSearchParams: () => ({ id: 'S1' }), useRouter: () => ({ push: mockPush }) }));
jest.mock('../src/lib/media', () => ({ ...jest.requireActual('../src/lib/media'), fetchCatalogCached: async (cb: any) => cb([{ id: 'video', name: 'Video', modality: 'text-to-video', credits: 12, durations: [10], gated: false, capabilities: { inputs: { prompt: { max: 4000 } } } }]) }));
void [RN.ScrollView, RN.Text, RN.Pressable, RN.StyleSheet, RN.View, RN.ActivityIndicator];
let root: Root;
const has = (text: string) => root.container.queryAll(n => n.children.some(c => typeof c === 'string' && c.includes(text))).length > 0;
function film() {
    const f = { ...web.emptyFilm(), name: 'Alice film', stack: { ...web.emptyFilm().stack, video: 'Video' },
        shots: [{ ...Object.fromEntries(web.SHOT_LANES.flatMap(([, fields]: any) => fields.map(([key]: any) => [key, 'detail']))), id: 'S1', oneAction: true, location: '', characters: 'none', props: 'none', seconds: '10', description: 'Alice private shot' }] };
    f.prompts = [{ shot: 'S1', version: 1, content: 'Alice prompt', context: web.promptContext(f, f.shots[0]), at: '2026-10-21' }];
    return f;
}
async function mount() { root = createRoot(); await act(async () => root.render(<Screen />)); }
beforeEach(async () => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; resetCacheUser(); await wipeCache(); await bindCacheUser('alice'); jest.clearAllMocks(); });
afterEach(async () => { if (root) await act(async () => root.unmount()); jest.restoreAllMocks(); resetCacheUser(); });
test.each(['bob', 'alice', null])('cloud shot and actions are revoked after session change to %s', async user => {
    const id = '11111111-1111-4111-8111-111111111111';
    await openCloudFilm({ request: jest.fn().mockResolvedValue({ project: { id, revision: 1 }, studio_json: JSON.stringify(film()) }) }, id);
    await mount(); expect(has('Alice private shot')).toBe(true); expect(has('Open in Create')).toBe(true);
    const queued = root.container.queryAll(n => n.props.accessibilityRole === 'button').map(n => n.props.onClick);
    const share = jest.spyOn(RN.Share, 'share').mockResolvedValue({ action: RN.Share.sharedAction, activityType: undefined });
    await act(async () => { await wipeCache(); if (user) await bindCacheUser(user); });
    expect(getOpenedFilm()).toBeNull(); expect(has('Alice private shot')).toBe(false); expect(has('Alice prompt')).toBe(false); expect(has('Open in Create')).toBe(false);
    expect(has('That shot is not in the studio on this phone.')).toBe(true);
    await act(async () => { for (const press of queued) press({ nativeEvent: {}, currentTarget: 1, target: 1 }); });
    expect(mockPush).not.toHaveBeenCalled(); expect(share).not.toHaveBeenCalled();
});
test('a delayed load of Alice’s imported shot cannot repopulate Bob’s screen', async () => {
    await saveStudio(JSON.stringify(film()));
    const saved = await appCache.read<any>({ name: 'film-studio', perUser: true, freshMs: 0, maxAgeMs: Infinity }, 'alice');
    let resolve!: (value: any) => void;
    jest.spyOn(appCache, 'read').mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    await mount(); await act(async () => bindCacheUser('bob'));
    await act(async () => resolve(saved));
    expect(has('Alice private shot')).toBe(false); expect(has('Open in Create')).toBe(false);
});

import en from '../src/lib/i18n/messages/en';
import { APP_CATALOGS } from '../src/lib/i18n';
import { BEAT_SOUNDS, BEAT_SHORTCUTS, BEAT_TEMPLATES, BEAT_TIP_STEPS, addAudioRegion, beatTipsSeenKey, createBeatFromTemplate, filterSounds, soundAsset, soundDuration, soundTicks, validateSound } from '../src/lib/beatNative/labs';
import { PHONE_CAPABILITIES, SHORTCUT_CAPABILITY, touchKey } from '../src/lib/beatNative/controls';
import { phoneTipSteps, nextTip, tipsSeen, markTipsSeen, secureTipKey, PHONE_TIP_TARGETS } from '../src/lib/beatNative/coachMarks';
import { createTemplateBeat } from '../src/lib/beatNative/templates';
import { soundTake, createSoundPreview } from '../src/lib/beatNative/soundPreview';
import { renderTakeSamples, SYNTH_RATE } from '../src/lib/instrumentShared';
import { createBeatStore } from '../src/lib/beatNative/store';
import { validateBeat, tryOp, MAX_TRACKS } from '../src/lib/beatNative/doc';
import { createHistory, record, undo } from '../src/lib/beatNative/history';
import { memoryFiles, fixedDoc, USER, deferred } from './beatNativeFixtures';

test.each(BEAT_TEMPLATES)('$id produces the exact shared template, validates, and is durable before return', async ({ id: template }) => {
    const files = memoryFiles(), store = createBeatStore(files);
    const result = await createTemplateBeat(store, template, 'Starter');
    expect(result).toEqual(createBeatFromTemplate({ template, id: result.id, title: result.title, now: result.createdAt }));
    expect(validateBeat(result).ok).toBe(true);
    expect(files.data.size).toBe(1);
    const saved = store.getBeat(result.id)!;
    expect({ ...saved, updatedAt: result.updatedAt }).toEqual(result); // N2 advances its save timestamp.
    expect(store.saveState(result.id)).toBe('saved');
});
test('creation awaits the write and cleans up a failed write, even if cleanup also fails', async () => {
    const files = memoryFiles(), write = deferred<void>(), store = createBeatStore({ ...files, write: () => write.promise, remove: async () => { throw new Error('disk'); } });
    const creating = createTemplateBeat(store, 'house', 'Test');
    let complete = false; void creating.then(() => { complete = true; }, () => {});
    await Promise.resolve(); expect(complete).toBe(false);
    write.reject(new Error('disk')); await expect(creating).rejects.toThrow('disk');
    expect(store.listBeats()).toEqual([]);
});
test('a refused put drops the half-made record', async () => {
    const store = createBeatStore(memoryFiles());
    await expect(createTemplateBeat({ ...store, putBeat: () => false }, 'blank', 'Test')).rejects.toThrow();
    expect(store.listBeats()).toEqual([]);
});
test('all starter sounds use shared metadata and produce undoable audio regions', () => {
    expect(BEAT_SOUNDS).toHaveLength(12);
    for (const sound of BEAT_SOUNDS) {
        expect(validateSound(sound)).toBe(true);
        const before = fixedDoc(), asset = soundAsset(sound, before.tempo.bpm);
        expect(asset).toEqual({ source: 'sound', ref: sound.id, name: sound.name, durationSec: soundDuration(sound.id, before.tempo.bpm), bpm: null, sourceChannels: 2, encodedBytes: 0 });
        const after = addAudioRegion(before, asset, undefined, 0);
        expect(validateBeat(after).ok).toBe(true);
        expect(after.tracks.at(-1)?.regions[0]).toMatchObject({ start: 0, length: soundTicks(sound.id) });
        const restored = undo(record(createHistory(before), after)).present;
        expect({ ...restored, updatedAt: before.updatedAt }).toEqual(before);
        expect(validateBeat(restored).ok).toBe(true);
    }
    const full = fixedDoc(); full.tracks = Array.from({ length: MAX_TRACKS }, (_, i) => ({ ...full.tracks[0], id: `t${i + 1}`, regions: [] }));
    expect(tryOp(full, doc => addAudioRegion(doc, soundAsset(BEAT_SOUNDS[0], doc.tempo.bpm), undefined, 0)).refused).toBeTruthy();
});
test('search matches English and translated names case-insensitively, plus category', () => {
    expect(filterSounds('WARM', 'All', () => 'Nappe chaude').map(s => s.id)).toEqual(['pad']);
    expect(filterSounds('CHAUDE', 'Synth', s => s.id === 'pad' ? 'Nappe chaude' : s.name).map(s => s.id)).toEqual(['pad']);
    expect(filterSounds('warm', 'Keys', s => s.name)).toEqual([]);
});
test.each([92, 40])('warm pad keeps its full duration at %i BPM', bpm => {
    const take = soundTake(BEAT_SOUNDS.find(s => s.id === 'pad')!, bpm);
    expect(take.events[0].dur).toBeCloseTo(16 * 60 / bpm);
    expect(take.length).toBeCloseTo(16 * 60 / bpm);
    expect(renderTakeSamples(take).length).toBeGreaterThanOrEqual(Math.ceil(take.length * SYNTH_RATE));
});
test('preview stops, releases and deletes cache on repeat, replacement and close; pending preparation cannot revive it', async () => {
    const players: { play: jest.Mock; pause: jest.Mock; remove: jest.Mock }[] = [];
    const files: { uri: string; remove: jest.Mock }[] = [];
    const port = { prepare: jest.fn(async () => {}), write: jest.fn(() => { const f = { uri: 'cache', remove: jest.fn() }; files.push(f); return f; }),
        player: jest.fn(() => { const p = { play: jest.fn(), pause: jest.fn(), remove: jest.fn(), addListener: jest.fn(() => ({ remove: jest.fn() })) }; players.push(p); return p; }) };
    const preview = createSoundPreview(port);
    await preview.toggle(BEAT_SOUNDS[0], 92); await preview.toggle(BEAT_SOUNDS[1], 92);
    expect(players[0].remove).toHaveBeenCalled(); expect(files[0].remove).toHaveBeenCalled();
    expect(await preview.toggle(BEAT_SOUNDS[1], 92)).toBeNull(); expect(players[1].pause).toHaveBeenCalled();
    const wait = deferred<void>(); port.prepare.mockImplementation(() => wait.promise);
    const pending = preview.toggle(BEAT_SOUNDS[0], 92); preview.stop(); wait.resolve();
    expect(await pending).toBeNull(); expect(players).toHaveLength(2);
});
test('every shortcut has a capability; only available capabilities have real touch copy', () => {
    const english: Record<string, string> = en;
    for (const [key, copy] of Object.entries(english).filter(([key]) => key.startsWith('beatLabs.touch.'))) {
        expect(copy).not.toMatch(/Use the touch controls:/i);
        expect(PHONE_CAPABILITIES.has(SHORTCUT_CAPABILITY[key.slice('beatLabs.touch.'.length)])).toBe(true);
    }
    for (const row of BEAT_SHORTCUTS) {
        expect(SHORTCUT_CAPABILITY[row.id]).toBeDefined();
        const copy = english[`beatLabs.touch.${row.id}`];
        if (PHONE_CAPABILITIES.has(SHORTCUT_CAPABILITY[row.id])) {
            expect(copy).toBeTruthy(); expect(copy).not.toMatch(/Use the touch controls:/i);
        } else expect(copy).toBeUndefined();
        expect(touchKey(row.id, new Set())).toBe('beatLabs.unavailable');
        expect(touchKey(row.id, PHONE_CAPABILITIES)).toBe(PHONE_CAPABILITIES.has(SHORTCUT_CAPABILITY[row.id]) ? `beatLabs.touch.${row.id}` : 'beatLabs.unavailable');
    }
});
test('coach skips missing targets; seen key is per user, safe storage failures hide tips', () => {
    const data = new Map<string, string>(), storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
    expect(phoneTipSteps(PHONE_TIP_TARGETS).map(s => s.id)).toEqual(['grid', 'library', 'play', 'shortcuts']);
    expect(nextTip(2, PHONE_TIP_TARGETS)?.id).toBe('shortcuts'); expect(nextTip(3, PHONE_TIP_TARGETS)).toBeNull();
    for (const step of BEAT_TIP_STEPS) expect((en as Record<string, string>)[`beatLabs.tip.${step.id}`]).toBeTruthy();
    expect(tipsSeen(storage, null)).toBe(true); expect(tipsSeen(storage, USER)).toBe(false);
    markTipsSeen(storage, USER); expect(data.get(beatTipsSeenKey(USER)!)).toBe('1'); expect(tipsSeen(storage, USER)).toBe(true);
    expect(secureTipKey(beatTipsSeenKey(USER)!)).not.toContain(':');
    const broken = { getItem() { throw new Error(); }, setItem() { throw new Error(); } };
    expect(tipsSeen(broken, USER)).toBe(true); expect(() => markTipsSeen(broken, USER)).not.toThrow();
});

test('a reset between put and flush cannot report a successful creation', async () => {
    const store = createBeatStore(memoryFiles()), drop = jest.spyOn(store, 'dropBeat');
    let reset = false;
    const flushBeat = async (id: string) => {
        if (!reset) { reset = true; store.resetBeats(); }
        await store.flushBeat(id);
    };
    await expect(createTemplateBeat({ ...store, flushBeat }, 'blank', 'Reset')).rejects.toThrow('save_failed');
    expect(drop).toHaveBeenCalledTimes(1); expect(store.listBeats()).toEqual([]);
});
test.each(['saving', 'busy', 'error'] as const)('flush returning with save state %s cannot report success', async state => {
    const store = createBeatStore(memoryFiles());
    await expect(createTemplateBeat({ ...store, saveState: () => state }, 'blank', 'Unsaved')).rejects.toThrow('save_failed');
    expect(store.listBeats()).toEqual([]);
});
test('natural preview finish releases the listener, player and file exactly once and notifies the sheet', async () => {
    let finish!: (status: { didJustFinish: boolean }) => void;
    const listener = { remove: jest.fn() }, file = { uri: 'cache', remove: jest.fn() };
    const player = { play: jest.fn(), pause: jest.fn(), remove: jest.fn(),
        addListener: jest.fn((_event: 'playbackStatusUpdate', callback: typeof finish) => { finish = callback; return listener; }) };
    const onFinish = jest.fn(), preview = createSoundPreview({ prepare: async () => {}, write: () => file, player: () => player }, onFinish);
    await preview.toggle(BEAT_SOUNDS[0], 92);
    finish({ didJustFinish: false }); expect(onFinish).not.toHaveBeenCalled();
    finish({ didJustFinish: true });
    expect(onFinish).toHaveBeenCalledTimes(1); expect(player.pause).toHaveBeenCalledTimes(1);
    expect(player.remove).toHaveBeenCalledTimes(1); expect(file.remove).toHaveBeenCalledTimes(1); expect(listener.remove).toHaveBeenCalledTimes(1);
    finish({ didJustFinish: true }); preview.stop();
    expect(onFinish).toHaveBeenCalledTimes(1); expect(player.remove).toHaveBeenCalledTimes(1);
});

test.each(Object.entries(APP_CATALOGS))('%s coach tips name the visible phone controls', (locale, catalog) => {
    const messages: Record<string, string> = catalog;
    expect(messages['beatLabs.tip.library']).toContain(messages['beatLabs.sounds']);
    expect(messages['beatLabs.tip.shortcuts']).toContain(messages['beatLabs.controls']);
    expect(messages['beatLabs.touch.help']).toContain(messages['beatLabs.controls']);
    expect(messages['beatLabs.tip.play']).toContain(messages['beat.play']);
    expect(messages['beatLabs.touch.play']).toContain(messages['beat.play']);
    expect(messages['beatLabs.touch.play']).toContain(messages['beat.stop']);
    const stepWord: Record<string, string> = { ar: 'خطوات', de: 'Schritte', es: 'pasos', fr: 'pas', hi: 'स्टेप', ja: 'ステップ', ko: '스텝', pt: 'passos', ru: 'шаги', zh: '步进' };
    expect(messages['beat.steps'].toLowerCase()).toContain(stepWord[locale].toLowerCase());
    expect(messages['beatLabs.tip.grid'].toLowerCase()).toContain(stepWord[locale].toLowerCase());
    expect(messages['beatLabs.category.FX']).not.toBe(messages['beatLabs.sounds']);
});

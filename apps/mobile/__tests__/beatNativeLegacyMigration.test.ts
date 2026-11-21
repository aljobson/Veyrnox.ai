// Old unstamped files on one phone, through the real sign-in path, store, take storage and erase path.
jest.mock('expo-file-system', () => require('./beatNativeMemoryDisk').expoFileSystem());
import { bindCacheUser, resetCacheUser, wipeCache } from '../src/lib/appCache';
import { createBeat, type BeatDoc } from '../src/lib/beatNative/doc';
import { eraseLocalBeats } from '../src/lib/beatNative/eraseLocal';
import { resetLegacyMigration } from '../src/lib/beatNative/legacyMigration';
import { checkMixdownOwner, ownedByOther, recordOwner } from '../src/lib/beatNative/mixdownSave';
import { maySync, type BeatRecord } from '../src/lib/beatNative/rules';
import { beatStore } from '../src/lib/beatNative/store';
import { createTakeFiles, legacyTakeIO } from '../src/lib/beatNative/takeFiles';
import { addAudioTrack, commitRecording, loadBeatTake, takeAsset, type AudioTake } from '../src/lib/beatNative/takeShared';
import { diskFaults, mockDisk } from './beatNativeMemoryDisk';
import { takeRow } from './beatNativeTakeFixtures';

const ALICE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', BOB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', PROJECT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const beatId = (n: number) => `11111111-1111-4111-8111-${String(n).padStart(12, '0')}`;
const takeId = (n: number) => `22222222-2222-4222-8222-${String(n).padStart(12, '0')}`;
const signIn = async (user: string) => { await bindCacheUser(user); await beatStore.hydrateBeats(); };
const signOut = () => wipeCache(undefined, undefined, 'signout');
const legacyPath = (id: string) => `documents/beats/${id}.json`;
const accountPath = (user: string, id: string) => `documents/beats/accounts/${user}/${id}.json`;
const paths = (part: string) => [...mockDisk.keys()].filter(path => path.includes(part));

function docWith(id: string, title: string, takes: AudioTake[]): BeatDoc {
    const base = addAudioTrack(createBeat({ id, title })), track = base.tracks.at(-1)!;
    return takes.length ? commitRecording(base, { trackId: track.id, start: 0, length: 1920, single: takes.length === 1, takes: takes.map(row => ({ asset: takeAsset(row) })) }) : base;
}
function seedBeat(doc: BeatDoc, user?: string) {
    const record: BeatRecord = { id: doc.id, revision: 3, doc, updatedAt: doc.updatedAt, ...(user ? { cloud: { userId: user, projectId: PROJECT, revision: 1, syncedUpdatedAt: doc.updatedAt } } : {}) };
    mockDisk.set(legacyPath(doc.id), new TextEncoder().encode(JSON.stringify(record)));
}
async function seedTake(id: string, origin: string) {
    const row = takeRow(id, origin), files = createTakeFiles(legacyTakeIO());
    await files.put(row);
    const { samples: _samples, ...state } = row;
    await files.putState({ ...state, state: 'committed' });
    return row;
}
beforeEach(async () => { await signOut(); resetCacheUser(); beatStore.resetBeats(); resetLegacyMigration(); mockDisk.clear(); diskFaults.write = diskFaults.move = diskFaults.read = diskFaults.remove = undefined; });

test('a linked old beat and its take go to the linked account, and every gate sees that owner', async () => {
    const id = beatId(1), take = await seedTake(takeId(1), id); seedBeat(docWith(id, 'Old linked', [take]), ALICE);
    await signIn(ALICE);
    const record = beatStore.getRecord(id)!;
    expect(record.owner).toBe(ALICE);
    expect((await loadBeatTake(take.id))?.samples).toEqual(take.samples);
    expect(mockDisk.has(legacyPath(id))).toBe(false); expect(paths(`beat-takes/${take.id}`)).toEqual([]);
    expect(recordOwner(record)).toBe(ALICE); expect(ownedByOther(recordOwner(record), ALICE)).toBe(false);
    expect(() => checkMixdownOwner(recordOwner(record), BOB)).toThrow();
    expect(maySync(record.cloud, ALICE)).toBe(true); expect(maySync(record.cloud, BOB)).toBe(false);
    expect((await beatStore.readSavedDoc(id))?.title).toBe('Old linked');
});

test('another account never sees or claims a linked beat, before or after its owner migrates', async () => {
    const id = beatId(2), take = await seedTake(takeId(2), id); seedBeat(docWith(id, 'Alice old', [take]), ALICE);
    await signIn(BOB);
    expect(beatStore.getBeat(id)).toBeUndefined(); expect(await loadBeatTake(take.id)).toBeNull(); expect(mockDisk.has(legacyPath(id))).toBe(true);
    await signOut(); await signIn(ALICE); expect(beatStore.getBeat(id)).toBeDefined();
    await signOut(); await signIn(BOB);
    expect(beatStore.getBeat(id)).toBeUndefined(); expect(await loadBeatTake(take.id)).toBeNull(); expect(paths(`accounts/${BOB}`)).toEqual([]);
});

test('never-synced old beats and their takes stay on disk and hidden from everyone', async () => {
    const id = beatId(3), take = await seedTake(takeId(3), id); seedBeat(docWith(id, 'No link', [take]));
    for (const user of [ALICE, BOB]) {
        await signOut(); await signIn(user);
        expect(beatStore.getBeat(id)).toBeUndefined(); expect(await loadBeatTake(take.id)).toBeNull();
    }
    expect(mockDisk.has(legacyPath(id))).toBe(true); expect(paths(`beat-takes/${take.id}`).length).toBeGreaterThan(0);
});

test('a take shared across accounts goes only to the owner of its origin beat and is not removed while another old beat uses it', async () => {
    const a = beatId(4), b = beatId(5), take = await seedTake(takeId(4), a);
    seedBeat(docWith(a, 'Origin', [take]), ALICE); seedBeat(docWith(b, 'Borrower', [take]), BOB);
    await signIn(BOB);
    expect(beatStore.getBeat(b)?.title).toBe('Borrower'); expect(await loadBeatTake(take.id)).toBeNull();
    expect(paths(`beat-takes/accounts/${BOB}/${take.id}`)).toEqual([]); expect(paths(`beat-takes/${take.id}`).length).toBeGreaterThan(0);
    await signOut(); await signIn(ALICE);
    expect((await loadBeatTake(take.id))?.samples).toEqual(take.samples);
});

test('a take shared with a never-synced beat is copied to its owner and the hidden original stays', async () => {
    const a = beatId(6), loose = beatId(7), take = await seedTake(takeId(6), a);
    seedBeat(docWith(a, 'Linked', [take]), ALICE); seedBeat(docWith(loose, 'Loose', [take]));
    await signIn(ALICE);
    expect(await loadBeatTake(take.id)).not.toBeNull(); expect(paths(`beat-takes/${take.id}`).length).toBeGreaterThan(0); expect(mockDisk.has(legacyPath(loose))).toBe(true);
});

test.each(['.f32', '.whole.json', '.state.json', '-beat'])('a failed move at %s stays hidden and the next sign-in finishes it', async stage => {
    const id = beatId(8), take = await seedTake(takeId(8), id); seedBeat(docWith(id, 'Interrupted', [take]), ALICE);
    const before = paths(`beat-takes/${take.id}`).length;
    diskFaults.write = uri => uri.includes(`accounts/${ALICE}`) && (stage === '-beat' ? uri.includes(id) : uri.includes(stage));
    await signIn(ALICE);
    expect(beatStore.getBeat(id)).toBeUndefined(); expect(mockDisk.has(legacyPath(id))).toBe(true); expect(paths(`beat-takes/${take.id}`)).toHaveLength(before);
    await signOut(); await signIn(BOB); expect(beatStore.getBeat(id)).toBeUndefined(); expect(await loadBeatTake(take.id)).toBeNull();
    diskFaults.write = undefined;
    await signOut(); await signIn(ALICE);
    expect(beatStore.getRecord(id)?.owner).toBe(ALICE); expect((await loadBeatTake(take.id))?.samples).toEqual(take.samples); expect(mockDisk.has(legacyPath(id))).toBe(false);
});

test('a rerun after the beat landed but before cleanup keeps the account copy and retires the original', async () => {
    const id = beatId(9), take = await seedTake(takeId(9), id); seedBeat(docWith(id, 'Rerun', [take]), ALICE);
    const original = mockDisk.get(legacyPath(id))!;
    await signIn(ALICE); await signOut();
    const landed = mockDisk.get(accountPath(ALICE, id));
    mockDisk.set(legacyPath(id), original); resetLegacyMigration();
    await signIn(ALICE);
    expect(mockDisk.get(accountPath(ALICE, id))).toEqual(landed); expect(mockDisk.has(legacyPath(id))).toBe(false);
    expect((await loadBeatTake(take.id))?.samples).toEqual(take.samples);
});

test('newer account work is never overwritten by an old copy, which stays hidden', async () => {
    const id = beatId(10); seedBeat(docWith(id, 'Old title', []), ALICE);
    const original = mockDisk.get(legacyPath(id))!;
    await signIn(ALICE); beatStore.putBeat({ ...beatStore.getBeat(id)!, title: 'Newer' }); await beatStore.flushBeats(); await signOut();
    mockDisk.set(legacyPath(id), original); resetLegacyMigration();
    await signIn(ALICE);
    expect(beatStore.getBeat(id)?.title).toBe('Newer'); expect(mockDisk.has(legacyPath(id))).toBe(true);
});

test('account deletion erases migrated and still-unmigrated beats for that account, and nobody else\'s', async () => {
    const mine = beatId(11), stuck = beatId(12), theirs = beatId(13);
    const mineTake = await seedTake(takeId(11), mine), stuckTake = await seedTake(takeId(12), stuck), theirTake = await seedTake(takeId(13), theirs);
    seedBeat(docWith(mine, 'Mine', [mineTake]), ALICE); seedBeat(docWith(stuck, 'Stuck', [stuckTake]), ALICE); seedBeat(docWith(theirs, 'Theirs', [theirTake]), BOB);
    diskFaults.write = uri => uri.includes(`accounts/${ALICE}/${stuck}`);
    await signIn(ALICE); diskFaults.write = undefined;
    await eraseLocalBeats(ALICE); await signOut();
    expect(paths(`accounts/${ALICE}`)).toEqual([]); expect(mockDisk.has(legacyPath(stuck))).toBe(false); expect(paths(`beat-takes/${stuckTake.id}`)).toEqual([]);
    await signIn(BOB);
    expect(beatStore.getBeat(theirs)?.title).toBe('Theirs'); expect((await loadBeatTake(theirTake.id))?.samples).toEqual(theirTake.samples);
});

describe.each([['after', true], ['before', false]])('account deletion %s migration', (_when, migrateFirst) => {
    test.each([['a never-synced beat', undefined], ['another account\'s beat', BOB]])('removes the owner\'s recording shared with %s', async (_label, otherUser) => {
        const mine = beatId(20), other = beatId(21), bobs = beatId(22);
        const shared = await seedTake(takeId(20), mine), bobTake = await seedTake(takeId(22), bobs), unknown = await seedTake(takeId(23), beatId(99));
        seedBeat(docWith(mine, 'Mine', [shared]), ALICE); seedBeat(docWith(other, 'Other', [shared]), otherUser); seedBeat(docWith(bobs, 'Bob own', [bobTake]), BOB);
        if (migrateFirst) await signIn(ALICE); else await bindCacheUser(BOB);
        if (!migrateFirst) await beatStore.hydrateBeats();
        await signOut();
        await eraseLocalBeats(ALICE);
        expect(paths(`beat-takes/${shared.id}`)).toEqual([]); expect(paths(`accounts/${ALICE}`)).toEqual([]); expect(mockDisk.has(legacyPath(mine))).toBe(false);
        if (!otherUser) expect(mockDisk.has(legacyPath(other))).toBe(true);
        expect([...paths(`beat-takes/${unknown.id}`), ...paths(`${bobTake.id}`)].length).toBeGreaterThan(1);
        await signIn(BOB);
        expect((await loadBeatTake(bobTake.id))?.samples).toEqual(bobTake.samples);
        expect(await loadBeatTake(shared.id)).toBeNull(); expect(await loadBeatTake(unknown.id)).toBeNull();
    });
});

test.each(['read', 'remove'] as const)('a %s failure on one take does not stop the rest of the deletion', async fault => {
    const first = beatId(30), second = beatId(31), bobs = beatId(32);
    const failing = await seedTake(takeId(30), first), other = await seedTake(takeId(31), second), bobTake = await seedTake(takeId(32), bobs);
    seedBeat(docWith(first, 'First', [failing]), ALICE); seedBeat(docWith(second, 'Second', [other]), ALICE); seedBeat(docWith(bobs, 'Bob', [bobTake]), BOB);
    const bobFiles = paths(`beat-takes/${bobTake.id}`);
    diskFaults[fault] = uri => uri.includes(`beat-takes/${failing.id}`);
    await eraseLocalBeats(ALICE);
    diskFaults[fault] = undefined;
    expect(paths(`beat-takes/${other.id}`)).toEqual([]);
    expect(mockDisk.has(legacyPath(first))).toBe(false); expect(mockDisk.has(legacyPath(second))).toBe(false);
    expect(mockDisk.has(legacyPath(bobs))).toBe(true); expect(paths(`beat-takes/${bobTake.id}`)).toEqual(bobFiles);
});

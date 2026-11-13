import { Directory, File } from 'expo-file-system';
import { instrumentTakeRoot, userDocStorage } from './appCache';
import type { CacheStorage } from './cache';
import { addToIndex, parseIndex, removeFromIndex, type SavedTake } from './instrumentTakeIndex';

export type StoredTake = SavedTake & { uri: string };
const USER = /^[A-Za-z0-9-]{8,64}$/;
const key = (user: string) => `instrument-takes.${user}`;
const folder = (user: string) => {
    if (!USER.test(user)) throw new Error('invalid_user');
    return new Directory(instrumentTakeRoot(), user);
};
const erase = (entry: File | Directory) => { try { if (entry.exists) entry.delete(); } catch { /* Already gone. */ } };

export async function listTakes(user: string, storage: CacheStorage = userDocStorage): Promise<StoredTake[]> {
    const index = parseIndex(await storage.get(key(user)), user);
    const dir = folder(user);
    return index.items.flatMap((item) => {
        const file = new File(dir, item.name);
        return file.exists ? [{ ...item, uri: file.uri }] : [];
    });
}

/** Copy a rendered WAV out of the purgeable cache into the person's own folder and index it. */
export async function saveTake(user: string, label: string, sourceUri: string, seconds: number, storage: CacheStorage = userDocStorage): Promise<StoredTake | null> {
    let destination: File | undefined;
    try {
        const dir = folder(user);
        dir.create({ intermediates: true, idempotent: true });
        const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;
        destination = new File(dir, `${id}.wav`);
        await new File(sourceUri).copy(destination);
        const item: SavedTake = { id, label, name: `${id}.wav`, seconds, createdAt: Date.now() };
        const { index, dropped } = addToIndex(parseIndex(await storage.get(key(user)), user), item);
        await storage.set(key(user), JSON.stringify(index));
        dropped.forEach((old) => erase(new File(dir, old.name)));
        return { ...item, uri: destination.uri };
    } catch {
        if (destination) erase(destination);
        return null;
    }
}

export async function deleteTake(user: string, id: string, storage: CacheStorage = userDocStorage): Promise<void> {
    const index = parseIndex(await storage.get(key(user)), user);
    const found = index.items.find((item) => item.id === id);
    await storage.set(key(user), JSON.stringify(removeFromIndex(index, id)));
    if (found) erase(new File(folder(user), found.name));
}

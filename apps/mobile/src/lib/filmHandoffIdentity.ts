import { randomUUID } from 'expo-crypto';
import { subscribeCacheUser } from './appCache';
import { accountHandoffStore, captureHandoffOwner } from './accountHandoffStore';
import type { Film } from './filmStudio';

interface Identity { id: string; cloudId?: string }
// Each slot stores only its local identity, never a copy of the film document.
const identities = accountHandoffStore<{ id: string; filmId: string }>('film-identity-slots', 20);
const phoneSlot = accountHandoffStore<{ id: string; filmId: string }>('phone-film-identity-slot', 1);
let objects = new WeakMap<Film, Identity>();
let observing = false;
function observeOwner() {
    if (!observing) {
        observing = true;
        subscribeCacheUser(() => { objects = new WeakMap(); });
    }
}
function identity(film: Film): Identity {
    observeOwner();
    let value = objects.get(film);
    if (!value) { value = { id: randomUUID() }; objects.set(film, value); }
    return value;
}
export function freshFilmIdentity(film: Film) {
    observeOwner();
    const id = randomUUID(); objects.set(film, { id }); return id;
}
export const localFilmId = (film: Film) => identity(film).id;
export function inheritFilmIdentity(previous: Film, next: Film) { objects.set(next, identity(previous)); }
export async function restoreFilmIdentity(film: Film, cloudId?: string): Promise<void> {
    const current = captureHandoffOwner();
    if (!cloudId) return;
    const known = (await identities.list()).find(i => i.id === cloudId);
    if (!current()) return;
    objects.set(film, { id: known?.filmId ?? randomUUID(), cloudId });
    await persistFilmIdentity(film, cloudId);
}
export async function persistFilmIdentity(film: Film, cloudId?: string) {
    const value = identity(film);
    if (cloudId) value.cloudId = cloudId;
    if (value.cloudId) await identities.put({ id: value.cloudId, filmId: value.id });
}
export async function restorePhoneFilmIdentity(film: Film) {
    observeOwner();
    const current = captureHandoffOwner();
    const known = (await phoneSlot.list())[0];
    if (!current()) return;
    objects.set(film, { id: known?.filmId ?? randomUUID() });
}
export function persistPhoneFilmIdentity(film: Film) {
    return phoneSlot.put({ id: 'phone', filmId: localFilmId(film) });
}

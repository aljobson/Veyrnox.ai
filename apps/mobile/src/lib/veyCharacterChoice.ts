import * as SecureStore from 'expo-secure-store';

// Which character the Vey helper wears: 'vey' is the built-in robot, the rest are wobnimo mascots
// (MIT, https://github.com/Pouryaak/wobnimo). Mirrors the web's lib/veyCharacterChoice.js. A picture preference only.
export const VEY_CHARACTER_KEY = 'veyrnox.vey.character.v1';
export const DEFAULT_VEY_CHARACTER = 'vey';

export const WOBNIMO_CHARACTERS = [
    'volt', 'pip', 'mochi', 'boo', 'inky', 'miso', 'tad', 'pebble', 'rex', 'microduck',
    'drift', 'cacti', 'latte', 'bumble', 'swirl', 'ember', 'cap', 'berry', 'bao', 'hop',
] as const;
export const VEY_CHARACTER_IDS = [DEFAULT_VEY_CHARACTER, ...WOBNIMO_CHARACTERS] as const;
export type VeyCharacterId = (typeof VEY_CHARACTER_IDS)[number];
export type WobnimoId = (typeof WOBNIMO_CHARACTERS)[number];
export type WobnimoState = 'idle' | 'thinking' | 'listening' | 'speaking' | 'sleeping' | 'working' | 'error' | 'surprised' | 'celebrating' | 'sad';

export function normaliseVeyCharacter(value: unknown): VeyCharacterId {
    return (VEY_CHARACTER_IDS as readonly unknown[]).includes(value) ? (value as VeyCharacterId) : DEFAULT_VEY_CHARACTER;
}

export function isWobnimoCharacter(id: string): id is WobnimoId {
    return (WOBNIMO_CHARACTERS as readonly string[]).includes(id);
}

export function parseVeyCharacter(raw: string | null): VeyCharacterId {
    try {
        const value = raw ? JSON.parse(raw) : null;
        return value?.version === 1 ? normaliseVeyCharacter(value.id) : DEFAULT_VEY_CHARACTER;
    } catch {
        return DEFAULT_VEY_CHARACTER;
    }
}

const MOOD_TO_STATE: Record<string, WobnimoState> = {
    thinking: 'thinking', working: 'working', listening: 'listening', cheer: 'celebrating', hop: 'celebrating', clap: 'celebrating', wave: 'surprised', worried: 'sad',
};
export function wobnimoStateForMood(mood: string | undefined): WobnimoState {
    return (mood && MOOD_TO_STATE[mood]) || 'idle';
}

// A tiny external store so every Vey on screen changes together. Starts on the default and loads the saved choice once.
let current: VeyCharacterId = DEFAULT_VEY_CHARACTER;
let loaded = false;
let revision = 0; // bumped by every choice, so a slow first read cannot undo one
let writes: Promise<unknown> = Promise.resolve();
const listeners = new Set<() => void>();

export function getVeyCharacter(): VeyCharacterId {
    return current;
}

export function subscribeVeyCharacter(listener: () => void): () => void {
    listeners.add(listener);
    if (!loaded) {
        loaded = true;
        const startedAt = revision;
        SecureStore.getItemAsync(VEY_CHARACTER_KEY)
            .then((raw) => {
                const saved = parseVeyCharacter(raw);
                if (revision === startedAt && saved !== current) { current = saved; listeners.forEach((l) => l()); }
            })
            .catch(() => {});
    }
    return () => { listeners.delete(listener); };
}

export async function setVeyCharacter(id: VeyCharacterId): Promise<void> {
    current = normaliseVeyCharacter(id);
    revision++;
    listeners.forEach((l) => l());
    const value = JSON.stringify({ version: 1, id: current });
    // Writes run in the order chosen. A failed write still leaves the choice in place for this session.
    writes = writes.then(() => SecureStore.setItemAsync(VEY_CHARACTER_KEY, value)).catch(() => {});
    await writes;
}

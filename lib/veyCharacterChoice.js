// Which character the Vey helper wears. 'vey' is the built-in robot; the rest are wobnimo mascots
// (MIT, https://github.com/Pouryaak/wobnimo). A preference only: it changes the picture, nothing else.
export const VEY_CHARACTER_STORAGE = 'veyrnox.vey.character.v1';
export const DEFAULT_VEY_CHARACTER = 'vey';

export const WOBNIMO_CHARACTERS = Object.freeze([
  'volt', 'pip', 'mochi', 'boo', 'inky', 'miso', 'tad', 'pebble', 'rex', 'microduck',
  'drift', 'cacti', 'latte', 'bumble', 'swirl', 'ember', 'cap', 'berry', 'bao', 'hop',
]);

export const VEY_CHARACTER_IDS = Object.freeze([DEFAULT_VEY_CHARACTER, ...WOBNIMO_CHARACTERS]);

export function normaliseVeyCharacter(value) {
  return VEY_CHARACTER_IDS.includes(value) ? value : DEFAULT_VEY_CHARACTER;
}

export function isWobnimoCharacter(id) {
  return WOBNIMO_CHARACTERS.includes(id);
}

export function readVeyCharacter(storage) {
  try {
    const value = JSON.parse(storage.getItem(VEY_CHARACTER_STORAGE));
    return value?.version === 1 ? normaliseVeyCharacter(value.id) : DEFAULT_VEY_CHARACTER;
  } catch { return DEFAULT_VEY_CHARACTER; }
}

export function writeVeyCharacter(storage, id) {
  try {
    storage.setItem(VEY_CHARACTER_STORAGE, JSON.stringify({ version: 1, id: normaliseVeyCharacter(id) }));
    return true;
  } catch { return false; }
}

// Vey's moods (web poses and mobile moods) onto wobnimo's ten states.
const MOOD_TO_STATE = Object.freeze({
  thinking: 'thinking',
  working: 'working',
  listening: 'listening',
  cheer: 'celebrating',
  hop: 'celebrating',
  clap: 'celebrating',
  wave: 'surprised',
  worried: 'sad',
});

export function wobnimoStateForMood(mood) {
  return MOOD_TO_STATE[mood] || 'idle';
}

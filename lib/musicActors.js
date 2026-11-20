import { isUuidLoose } from './validate.js';

/** Opaque public identity only; absent or malformed ids are omitted. */
export const musicActorField = (value, key = 'creator_id') => typeof value === 'string' && isUuidLoose(value) ? { [key]: value } : {};

export function publicMusicCreator(row) {
    const { creator_id: actor, ...fields } = row;
    return { ...fields, ...musicActorField(actor) };
}

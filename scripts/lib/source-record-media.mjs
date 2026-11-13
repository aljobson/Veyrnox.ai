// Missing media is not an identity: two absent sourceMediaIds must never match.
export const hasSourceMediaId = value => typeof value === 'string' && value.trim().length > 0;

export const sameSourceMedia = (record, mediaId) => hasSourceMediaId(mediaId)
  && hasSourceMediaId(record?.sourceMediaId) && record.sourceMediaId === mediaId;

export function sourceMediaEntries(records) {
  return Object.entries(records).filter(([, record]) => hasSourceMediaId(record?.sourceMediaId))
    .map(([id, record]) => [id, record.sourceMediaId]);
}

export function sourceRecordIdsForMedia(records, mediaId) {
  return Object.entries(records).filter(([, record]) => sameSourceMedia(record, mediaId)).map(([id]) => id);
}

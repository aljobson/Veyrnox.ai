export const MUSIC_LONG_SONG_MAX = 135;

function longSongsEnabled(modelId, longSongs) {
    return modelId === 'ace-step-1.5' && longSongs === true;
}

export function musicDurationBounds(modelId, { longSongs = false } = {}) {
    return { min: 10, max: longSongsEnabled(modelId, longSongs) ? MUSIC_LONG_SONG_MAX : 60, default: 60 };
}

export function musicDurationControls(modelId, { longSongs = false } = {}) {
    return {
        duration_seconds: musicDurationBounds(modelId, { longSongs }),
        ...(longSongsEnabled(modelId, longSongs) ? { duration_price_block_seconds: 60 } : {}),
    };
}

/** Display hints only; the database remains authoritative for quote prices and charging. */
export function musicDurationPriceBlocks(modelId, seconds) {
    return modelId === 'ace-step-1.5' ? Math.ceil(seconds / 60) : 1;
}

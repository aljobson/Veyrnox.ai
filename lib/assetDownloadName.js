// The file name a downloaded asset is saved under. It is made only from the job id and a fixed list of
// extensions, so nothing a user typed, and no text from the stored type, reaches the response header.

const EXTENSION = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'video/mp4': 'mp4',
    'audio/mpeg': 'mp3',
    'audio/wav': 'wav',
};

/**
 * @param {string} jobId      a job UUID the route has already validated
 * @param {string} [mimeType] the asset's stored type; one that is not listed gets no extension
 * @returns {string} for example `veyrnox-1a2b3c4d.mp4`
 */
export function assetDownloadName(jobId, mimeType) {
    const extension = EXTENSION[String(mimeType ?? '').toLowerCase()];
    return `veyrnox-${String(jobId).slice(0, 8).toLowerCase()}${extension ? `.${extension}` : ''}`;
}

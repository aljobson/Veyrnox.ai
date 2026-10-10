import { sequenceTransitionAfter } from './editorSequence.mjs';
import { timelineSize } from './editorRender.mjs';
import { EXPORT_BITRATES } from './editorExportSettings.mjs';
/** Conservative allocation estimate: retained image bitmaps, active video decoder buffers, encoder/output and stereo PCM. */
export function exportMemoryProblem(tl, height, quality) {
    if (tl.schemaVersion !== 3) return null;
    const events = [], { width, height: outputHeight } = timelineSize(tl, height);
    let images = 0;
    for (const media of Object.values(tl.media)) if (media.kind === 'image') images += media.width * media.height * 4;
    for (const clip of tl.video) {
        const media = tl.media[clip.mediaId]; if (['image', 'graphic'].includes(media.kind)) continue;
        const bytes = media.width * media.height * 4 * 5;
        events.push([clip.start, bytes], [clip.start + clip.len + sequenceTransitionAfter(tl, clip), -bytes]);
    }
    let active = 0, peak = 0;
    for (const [, bytes] of events.sort((a, b) => a[0] - b[0] || a[1] - b[1])) { active += bytes; peak = Math.max(peak, active); }
    const seconds = Math.max(0, ...[...tl.video, ...tl.audio, ...tl.text].map(c => c.start + c.len)) / 30;
    const estimated = images + peak + width * outputHeight * 4 * 4 + seconds * 48000 * 2 * 4 + EXPORT_BITRATES[quality] * seconds / 8;
    return estimated > 1024 * 1024 * 1024 ? 'This edit exceeds the browser working-memory budget. Use lower resolution sources, fewer overlapping layers or a shorter edit.' : null;
}

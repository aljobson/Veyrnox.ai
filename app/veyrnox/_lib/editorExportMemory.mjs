import { audioWorkingBytes } from './editorSpeed.mjs';
import { sequenceTransitionAfter } from './editorSequence.mjs';
import { timelineSize } from './editorRender.mjs';
import { EXPORT_BITRATES } from './editorExportSettings.mjs';
/** Conservative allocation estimate: retained image bitmaps, active video decoder buffers, encoder/output and stereo PCM. */
export function exportMemoryProblem(tl, height, quality, bitrate=EXPORT_BITRATES[quality]) {
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
    const extraSurfaces=tl.video.some(c=>c.colourAdjustment || c.parameterKeyframes?.length)?2:0;
    const smartSurfaces=tl.video.some(c=>c.smartPicture?.denoise || c.smartPicture?.keyEnabled || c.smartPicture?.light)?4:0;
    const backgrounds=tl.video.some(c=>c.background?.type==='blur')?2:0;
    const masks=tl.video.some(c=>c.mask && c.mask!=='none')?2:0;
    const estimated = images + peak + audioWorkingBytes(tl) + width * outputHeight * 4 * (4+extraSurfaces+masks+backgrounds+smartSurfaces) + bitrate * seconds / 8;
    return estimated > 1024 * 1024 * 1024 ? 'This edit exceeds the browser working-memory budget. Use lower resolution sources, fewer overlapping layers or a shorter edit.' : null;
}

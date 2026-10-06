// A few still frames from a video the person chose, taken in their own browser (ADR-0068 amendment 3). Chat reads images only, so a
// clip is attached as 2 to 4 frames, each an ordinary image: the same price, limits and checks, and the video itself never leaves the
// device. The timing is pure and tested without a DOM; extractFrames needs one.
import { scaledSize } from './chatImages.js';

export const VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];
export const FRAME_EDGE = 1280;       // frames are drawn no larger than this; prepareImage still enforces the chat's own cap at Send
const STEP_TIMEOUT_MS = 12000;        // a clip the browser cannot decode must fail, not hang the composer

/** An MP4, WebM or MOV by its declared type. The browser decides whether it can actually play it. */
export function isVideoFile(file) {
  return !!file && VIDEO_TYPES.includes(file.type);
}

/**
 * The moments to capture: the middle of each of `count` equal parts of the clip, so the first frame is never the black opening one
 * and the last is never the final blank. Always `count` ascending times inside the clip, or [] for a clip with no length.
 */
export function frameTimes(duration, count) {
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isInteger(count) || count < 1) return [];
  const last = Math.max(0, duration - 0.05);
  return Array.from({ length: count }, (_, i) => Math.min(last, (duration * (i + 0.5)) / count));
}

function once(video, name, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error('video_unreadable')); }, ms);
    const onOk = () => { cleanup(); resolve(); };
    const onErr = () => { cleanup(); reject(new Error('video_unreadable')); };
    function cleanup() { clearTimeout(timer); video.removeEventListener(name, onOk); video.removeEventListener('error', onErr); }
    video.addEventListener(name, onOk);
    video.addEventListener('error', onErr);
  });
}

/**
 * `count` JPEG frames from the clip, as Files named frame-1.jpg and so on.
 * Throws Error('video_unreadable') when the browser cannot decode the clip.
 */
export async function extractFrames(file, count) {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true; video.playsInline = true; video.preload = 'auto'; video.src = url;
  try {
    await once(video, 'loadedmetadata', STEP_TIMEOUT_MS);
    const times = frameTimes(video.duration, count);
    if (times.length === 0 || !video.videoWidth || !video.videoHeight) throw new Error('video_unreadable');
    const size = scaledSize(video.videoWidth, video.videoHeight, FRAME_EDGE);
    const canvas = document.createElement('canvas');
    canvas.width = size.width; canvas.height = size.height;
    const ctx = canvas.getContext('2d');
    const frames = [];
    for (const t of times) {
      video.currentTime = t;
      await once(video, 'seeked', STEP_TIMEOUT_MS);
      ctx.drawImage(video, 0, 0, size.width, size.height);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
      if (!blob) throw new Error('video_unreadable');
      frames.push(new File([blob], `frame-${frames.length + 1}.jpg`, { type: 'image/jpeg' }));
    }
    return frames;
  } finally {
    URL.revokeObjectURL(url);
    video.removeAttribute('src');
    video.load();
  }
}

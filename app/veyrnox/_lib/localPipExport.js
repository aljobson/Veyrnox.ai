export const LOCAL_PIP_FPS = 30;
export const LOCAL_PIP_MAX_EDGE = 1280;
export const LOCAL_PIP_MIME_TYPES = Object.freeze([
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
]);

export function localPipSupport(environment = globalThis) {
  const Recorder = environment?.MediaRecorder;
  const canvas = environment?.document?.createElement?.('canvas');
  const Audio = environment?.AudioContext || environment?.webkitAudioContext;
  if (!Recorder || !canvas?.captureStream || !Audio) return { ok: false, code: 'browser_unsupported' };
  const mimeType = LOCAL_PIP_MIME_TYPES.find((type) => Recorder.isTypeSupported?.(type));
  return mimeType ? { ok: true, mimeType } : { ok: false, code: 'format_unsupported' };
}

export function localPipCanvasSize(width, height, maxEdge = LOCAL_PIP_MAX_EDGE) {
  const w = Number(width);
  const h = Number(height);
  if (!(w > 0) || !(h > 0)) return { width: 1280, height: 720 };
  const scale = Math.min(1, maxEdge / Math.max(w, h));
  return {
    width: Math.max(2, Math.floor((w * scale) / 2) * 2),
    height: Math.max(2, Math.floor((h * scale) / 2) * 2),
  };
}

export function localPipOverlayRect({ canvasWidth, canvasHeight, sourceWidth, sourceHeight, position, shape }) {
  const margin = Math.max(12, Math.round(Math.min(canvasWidth, canvasHeight) * 0.04));
  let width;
  let height;
  if (shape === 'circle') {
    width = height = Math.round(Math.min(canvasWidth, canvasHeight) * 0.32);
  } else {
    const ratio = sourceWidth > 0 && sourceHeight > 0 ? sourceWidth / sourceHeight : 9 / 16;
    width = Math.round(canvasWidth * 0.26);
    height = Math.round(width / ratio);
    const maxHeight = Math.round(canvasHeight * 0.42);
    if (height > maxHeight) {
      height = maxHeight;
      width = Math.round(height * ratio);
    }
  }
  const left = position.endsWith('right') ? canvasWidth - margin - width : margin;
  const top = position.startsWith('bottom') ? canvasHeight - margin - height : margin;
  return { left, top, width, height, radius: shape === 'circle' ? width / 2 : Math.max(8, Math.round(width * 0.06)) };
}

function waitForVideo(video) {
  return new Promise((resolve, reject) => {
    if (video.readyState >= 2 && video.videoWidth > 0) return resolve();
    const timeout = setTimeout(() => reject(new Error('source_timeout')), 20_000);
    const done = () => { clearTimeout(timeout); cleanup(); resolve(); };
    const failed = () => { clearTimeout(timeout); cleanup(); reject(new Error('source_unreadable')); };
    const cleanup = () => {
      video.removeEventListener('loadeddata', done);
      video.removeEventListener('error', failed);
    };
    video.addEventListener('loadeddata', done, { once: true });
    video.addEventListener('error', failed, { once: true });
    video.load();
  });
}

function drawCover(context, source, x, y, width, height) {
  const sourceRatio = source.videoWidth / source.videoHeight;
  const targetRatio = width / height;
  let sx = 0;
  let sy = 0;
  let sw = source.videoWidth;
  let sh = source.videoHeight;
  if (sourceRatio > targetRatio) {
    sw = source.videoHeight * targetRatio;
    sx = (source.videoWidth - sw) / 2;
  } else {
    sh = source.videoWidth / targetRatio;
    sy = (source.videoHeight - sh) / 2;
  }
  context.drawImage(source, sx, sy, sw, sh, x, y, width, height);
}

export async function exportLocalPictureInPicture({
  performanceBlob,
  backgroundFile,
  settings,
  onProgress = () => {},
  environment = globalThis,
}) {
  const support = localPipSupport(environment);
  if (!support.ok) throw new Error(support.code);
  if (!(performanceBlob instanceof Blob) || !(backgroundFile instanceof Blob)) throw new Error('source_unreadable');

  const doc = environment.document;
  const performanceUrl = URL.createObjectURL(performanceBlob);
  const backgroundUrl = URL.createObjectURL(backgroundFile);
  const performance = doc.createElement('video');
  const background = doc.createElement('video');
  const canvas = doc.createElement('canvas');
  const hiddenStyle = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;left:-10px;top:-10px';
  performance.setAttribute('style', hiddenStyle);
  background.setAttribute('style', hiddenStyle);
  performance.playsInline = true;
  background.playsInline = true;
  performance.preload = 'auto';
  background.preload = 'auto';
  background.loop = true;
  performance.src = performanceUrl;
  background.src = backgroundUrl;
  doc.body.append(performance, background);

  let audioContext;
  let stream;
  let recorder;
  let raf = 0;
  let timeout = 0;
  try {
    await Promise.all([waitForVideo(performance), waitForVideo(background)]);
    if (!(Number.isFinite(performance.duration) && performance.duration > 0 && performance.duration <= 180)) throw new Error('duration_unsupported');
    const size = localPipCanvasSize(background.videoWidth, background.videoHeight);
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('browser_unsupported');
    stream = canvas.captureStream(LOCAL_PIP_FPS);
    const Audio = environment.AudioContext || environment.webkitAudioContext;
    audioContext = new Audio();
    const destination = audioContext.createMediaStreamDestination();
    const narrationVideo = settings.narration === 'background' ? background : performance;
    const audioSource = audioContext.createMediaElementSource(narrationVideo);
    audioSource.connect(destination);
    for (const track of destination.stream.getAudioTracks()) stream.addTrack(track);

    recorder = new environment.MediaRecorder(stream, { mimeType: support.mimeType, videoBitsPerSecond: 6_000_000 });
    const chunks = [];
    recorder.addEventListener('dataavailable', (event) => { if (event.data?.size) chunks.push(event.data); });
    const finished = new Promise((resolve, reject) => {
      recorder.addEventListener('stop', () => resolve(new Blob(chunks, { type: support.mimeType.split(';')[0] })), { once: true });
      recorder.addEventListener('error', () => reject(new Error('recording_failed')), { once: true });
    });
    const overlay = localPipOverlayRect({
      canvasWidth: size.width,
      canvasHeight: size.height,
      sourceWidth: performance.videoWidth,
      sourceHeight: performance.videoHeight,
      position: settings.position,
      shape: settings.shape,
    });
    let stopped = false;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      cancelAnimationFrame(raf);
      clearTimeout(timeout);
      performance.pause();
      background.pause();
      if (recorder.state !== 'inactive') recorder.stop();
    };
    const draw = () => {
      drawCover(context, background, 0, 0, size.width, size.height);
      context.save();
      context.beginPath();
      if (settings.shape === 'circle') context.arc(overlay.left + overlay.radius, overlay.top + overlay.radius, overlay.radius, 0, Math.PI * 2);
      else context.roundRect(overlay.left, overlay.top, overlay.width, overlay.height, overlay.radius);
      context.clip();
      drawCover(context, performance, overlay.left, overlay.top, overlay.width, overlay.height);
      context.restore();
      context.strokeStyle = 'rgba(255,255,255,0.9)';
      context.lineWidth = Math.max(2, Math.round(size.width / 320));
      context.beginPath();
      if (settings.shape === 'circle') context.arc(overlay.left + overlay.radius, overlay.top + overlay.radius, overlay.radius - context.lineWidth / 2, 0, Math.PI * 2);
      else context.roundRect(overlay.left, overlay.top, overlay.width, overlay.height, overlay.radius);
      context.stroke();
      onProgress(Math.min(1, performance.currentTime / performance.duration));
      if (!stopped) raf = requestAnimationFrame(draw);
    };

    performance.addEventListener('ended', stop, { once: true });
    recorder.start(250);
    await audioContext.resume();
    await Promise.all([background.play(), performance.play()]);
    draw();
    timeout = setTimeout(stop, Math.ceil(performance.duration * 1000) + 1500);
    const result = await finished;
    stream.getTracks().forEach((track) => track.stop());
    onProgress(1);
    return result;
  } finally {
    cancelAnimationFrame(raf);
    clearTimeout(timeout);
    if (recorder?.state && recorder.state !== 'inactive') {
      try { recorder.stop(); } catch {}
    }
    stream?.getTracks().forEach((track) => track.stop());
    performance.pause();
    background.pause();
    performance.remove();
    background.remove();
    if (audioContext && audioContext.state !== 'closed') await audioContext.close().catch(() => {});
    URL.revokeObjectURL(performanceUrl);
    URL.revokeObjectURL(backgroundUrl);
  }
}

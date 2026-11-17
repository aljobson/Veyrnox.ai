import { beatFailure } from './beatErrors.mjs';
export const UNSUPPORTED_RECORDING = "This browser can't record audio in the beat editor.";
const loaded = new WeakMap();
export async function openBeatCapture(context, deviceId = 'default', { onEnded = () => {} } = {}) {
  const policy = document.permissionsPolicy || document.featurePolicy;
  if (policy?.allowsFeature?.('microphone') === false) throw beatFailure('microphone-policy');
  if (!context.audioWorklet || !globalThis.AudioWorkletNode || !navigator.mediaDevices?.getUserMedia) throw beatFailure('recording-unsupported');
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { ...(deviceId !== 'default' ? { deviceId: { exact: deviceId } } : {}), echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 } });
    if (!loaded.has(context)) loaded.set(context, context.audioWorklet.addModule('/audio-worklets/beat-capture-worklet.js').catch(e => { loaded.delete(context); throw e; }));
    await loaded.get(context);
    const source = context.createMediaStreamSource(stream), worklet = new AudioWorkletNode(context, 'beat-capture'), silence = context.createGain(), analyser = context.createAnalyser();
    silence.gain.value = 0; source.connect(worklet).connect(silence).connect(context.destination); source.connect(analyser);
    const listeners = new Set(), pending = new Map(); let sequence = 0, closed = false, ended = false;
    const track = stream.getAudioTracks()[0];
    track.addEventListener('ended', () => { ended = true; onEnded(); });
    worklet.port.onmessage = ({ data }) => {
      if (data.type === 'flushed') pending.get(data.id)?.();
      else if (data.samples) listeners.forEach(fn => fn(data));
    };
    return { context, analyser, deviceId: track.getSettings().deviceId || deviceId,
      get ended() { return ended || closed; },
      subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
      flush() {
        return new Promise(resolve => {
          const id = ++sequence;
          const finish = value => { clearTimeout(timer); pending.delete(id); resolve(value); };
          const timer = setTimeout(() => finish(false), 1000);
          pending.set(id, () => finish(true));
          if (closed || context.state !== 'running') finish(false); else worklet.port.postMessage({ type: 'flush', id });
        });
      },
      close() { closed = true; for (const finish of pending.values()) finish(); listeners.clear(); stream.getTracks().forEach(t => t.stop()); source.disconnect(); analyser.disconnect(); worklet.disconnect(); silence.disconnect(); },
    };
  } catch (e) {
    stream?.getTracks().forEach(t => t.stop());
    if (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError') throw beatFailure('microphone-blocked');
    if (e.name === 'OverconstrainedError' || e.name === 'NotFoundError') throw beatFailure('microphone-missing');
    throw e;
  }
}
// Wall-clock bounded and interruptible even when the AudioContext clock stops.
export async function drainCapture(capture, end, rtt, { timer = setTimeout, cancel = clearTimeout } = {}) {
  const context = capture.context;
  const alive = () => context.state === 'running' && !capture.ended;
  if (!alive()) return false;
  async function wait(ms, work) {
    return new Promise(resolve => {
      let done = false, timeout, poll;
      const finish = value => { if (done) return; done = true; cancel(timeout); cancel(poll); resolve(value); };
      const check = () => { if (!alive()) finish(false); else poll = timer(check, 20); };
      timeout = timer(() => finish(!work), ms); check();
      if (work) Promise.resolve().then(work).then(value => finish(value !== false), () => finish(false));
    });
  }
  const remaining = Math.max(0, (end + rtt + 0.05 - context.currentTime) * 1000);
  if (!await wait(Math.min(remaining, rtt * 1000 + 250))) return false;
  return alive() && await wait(1000, () => capture.flush());
}

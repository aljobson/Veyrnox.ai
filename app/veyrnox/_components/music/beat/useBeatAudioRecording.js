'use client';
import { useEffect, useRef, useState } from 'react';
import { openBeatCapture } from '../../../_lib/music/beat/beatCapture.js';
import { readLatency } from '../../../_lib/music/beat/beatLatency.mjs';
import { createAudioRecording, audioRecordingRange, takeAsset } from '../../../_lib/music/beat/beatAudioRecordingSession.js';
import { commitRecording, recordingCapacity } from '../../../_lib/music/beat/beatTakeOps.mjs';
import { BEAT_TAKE_BYTES, beatTakeBytes, hydrateBeatTakes, documentHasTake, pendingBeatTakes, reconcileBeatTakes, discardBeatTakes } from '../../../_lib/music/beat/beatTakeStore.js';
import { tickSeconds } from '../../../_lib/music/beat/beatAudioSegments.mjs';
export function useBeatAudioRecording(current, edit, announce, audio, stop, playing = false) {
  const lastArm = useRef(null), recoveryFailed = useRef(false), recoveryDocument = useRef(current.current);
  const capture = useRef(null), session = useRef(null), intent = useRef(0), armed = useRef(null), mounted = useRef(true);
  const [state, setState] = useState({ status: 'idle', seconds: 0, pass: 1, error: '' });
  const [armedId, setArmedId] = useState(null), [deviceId, setDeviceId] = useState('default'), [devices, setDevices] = useState([]), [recovery, setRecovery] = useState([]);
  const latestStop = useRef(stop); useEffect(() => { latestStop.current = stop; });
  const stateRef = useRef(state);
  function show(patch) { stateRef.current = { ...stateRef.current, ...patch }; if (mounted.current) setState(stateRef.current); }
  async function refreshDevices() {
    try { const all = await navigator.mediaDevices?.enumerateDevices(); if (mounted.current) setDevices((all || []).filter(d => d.kind === 'audioinput')); } catch { /* Input remains usable without a device list. */ }
  }
  const pendingError = () => session.current?.error || '';
  const idleStatus = () => capture.current ? 'armed' : 'idle';
  async function arm(trackId, selectedDevice = deviceId) {
    if (session.current && !session.current.finishing) await latestStop.current();
    const token = ++intent.current;
    capture.current?.close(); capture.current = null; armed.current = null; setArmedId(null);
    if (!trackId) { show({ status: 'idle', error: pendingError() }); return; }
    lastArm.current = trackId; armed.current = trackId; setArmedId(trackId); show({ status: 'opening', error: pendingError() });
    function disconnected() {
      if (token !== intent.current) return;
      capture.current?.close(); capture.current = null; armed.current = null; setArmedId(null);
      const message = 'Microphone disconnected — Arm again';
      show({ status: 'error', error: pendingError() || message }); announce(message);
    }
    try {
      const { instance, resumed } = audio(); await resumed;
      const input = await openBeatCapture(instance.context, selectedDevice, { onEnded: () => {
        if (token !== intent.current) return;
        if (['recording', 'finishing'].includes(stateRef.current.status)) {
          announce('Input disconnected — recording stopped and audio kept.');
          void latestStop.current().then(() => disconnected());
        } else disconnected();
      } });
      if (token !== intent.current || !mounted.current) { input.close(); return; }
      capture.current = input; if (input.ended) { disconnected(); return; } show({ status: 'armed', error: pendingError() }); await refreshDevices();
    } catch (e) {
      if (token !== intent.current) return;
      armed.current = null; setArmedId(null); show({ status: 'error', error: e.message }); announce(e.message);
    }
  }
  async function refreshRecovery(active = () => mounted.current) {
    try {
      const saved = recoveryDocument.current;
      await reconcileBeatTakes(saved);
      if (active()) { recoveryFailed.current = false; setRecovery(pendingBeatTakes(saved.id)); }
    } catch {
      if (active()) {
        recoveryFailed.current = true;
        const message = "Couldn't read takes on this device — Retry";
        show({ error: message }); announce(message);
      }
    }
  }
  const projectId = current.current?.id;
  useEffect(() => {
    if (!projectId) return;
    let active = true; recoveryDocument.current = current.current;
    void refreshRecovery(() => active);
    return () => { active = false; };
  }, [projectId, current, announce]);
  useEffect(() => {
    mounted.current = true;
    const hide = () => { intent.current++; void latestStop.current(); capture.current?.close(); capture.current = null; armed.current = null; };
    const showPage = () => { if (!capture.current) { setArmedId(null); show({ status: 'idle' }); } };
    window.addEventListener('pageshow', showPage);
    navigator.mediaDevices?.addEventListener('devicechange', refreshDevices);
    window.addEventListener('pagehide', hide);
    return () => { mounted.current = false; hide(); navigator.mediaDevices?.removeEventListener('devicechange', refreshDevices); window.removeEventListener('pagehide', hide); window.removeEventListener('pageshow', showPage); };
  }, [projectId]);
  const trackPresent = !armedId || current.current?.tracks.some(t => t.id === armedId);
  useEffect(() => { if (!trackPresent) { intent.current++; capture.current?.close(); capture.current = null; armed.current = null; queueMicrotask(() => { setArmedId(null); show({ status: 'idle' }); }); } }, [trackPresent]);
  async function prepare(locator) {
    if (!capture.current || !armed.current) throw new Error('Arm the audio track again to enable its microphone.');
    await hydrateBeatTakes();
    const availableSeconds = (BEAT_TAKE_BYTES - beatTakeBytes()) / (capture.current.context.sampleRate * 4);
    if (availableSeconds < 1) throw new Error('Recorded takes use 1 GB on this device. Free storage before recording.');
    const range = audioRecordingRange(current.current, locator);
    const capacity = recordingCapacity(current.current, armed.current, { start: range.start, length: range.cycle ? range.length : 240, single: !range.cycle, preflight: !range.cycle });
    if (!capacity.lanes) throw new Error(capacity.reason);
    return { ...range, maxSeconds: Math.min(600, availableSeconds) };
  }
  function sequence(range, countIn) {
    return { doc: { ...current.current, view: 'song' }, recording: true, startStep: (range.start - (countIn ? 3840 : 0)) / 240,
      endStep: (range.start + range.length) / 240, loop: range.cycle ? { start: range.start / 240, end: (range.start + range.length) / 240 } : null, recordStart: range.start };
  }
  function begin(range, contextStart, countIn) {
    const input = capture.current, latency = readLatency(input.deviceId);
    const rtt = latency ? latency.ms / 1000 : (input.context.outputLatency || 0) + (input.context.baseLatency || 0);
    show({ status: 'recording', seconds: 0, pass: 1, error: '' });
    session.current = createAudioRecording({ doc: current.current, trackId: armed.current, range, capture: input, rtt, contextStart, countIn,
      current: () => current.current, edit, announce, onSettled: () => { session.current = null; },
      onState: patch => show({ ...patch, ...(patch.status === 'armed' ? { status: idleStatus() } : {}) }), stop: () => latestStop.current() });
    return contextStart + (countIn ? tickSeconds(3840, current.current.tempo.bpm) : 0);
  }
  async function recover(discard = false) {
    try {
      if (discard) await discardBeatTakes(recovery.map(r => r.id));
      else {
        const groups = new Map();
        for (const row of recovery) { const key = row.pending.recordingId; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(row); }
        for (const rows of groups.values()) {
          const unsaved = rows.filter(row => !documentHasTake(current.current, row)).sort((a, b) => a.pending.pass - b.pending.pass);
          if (!unsaved.length) continue;
          const { trackId, start, length, cycle } = unsaved[0].pending;
          if (!edit(d => commitRecording(d, { trackId, start, length, single: !cycle, takes: unsaved.map(row => ({ asset: takeAsset(row) })) }), { recordingCommit: true, label: 'Recover recorded takes' })) throw new Error('Could not recover these takes. Make room on the original audio track and try again.');
        }
      }
      setRecovery([]);
    } catch (e) { show({ status: 'error', error: e.message }); announce(e.message); }
  }
  return { ...state, error: pendingError() || state.error, calibrationDisabled: playing || ['recording', 'finishing'].includes(state.status), armedId, capture, deviceId, devices, recovery, recover, arm,
    // After a failed or unplugged input the track is disarmed; choosing another input re-arms it (REVIEW-003).
    selectDevice: id => { setDeviceId(id); const target = armedId ?? lastArm.current; return target ? arm(target, id) : undefined; },
    refreshDevices, prepare, sequence, begin, window: window => session.current?.window(window),
    armed: () => armed.current, locked: () => ['recording', 'finishing'].includes(stateRef.current.status),
    finish: () => ['recording', 'finishing'].includes(stateRef.current.status) ? session.current.finish() : Promise.resolve(current.current), retry: async () => {
      if (session.current?.error) return session.current.retry();
      if (recoveryFailed.current) { await refreshRecovery(); if (!recoveryFailed.current) show({ error: '' }); return; }
      if (lastArm.current) return arm(lastArm.current);
    },
    discard: () => session.current?.discard(),
    hasPending: () => !!session.current?.error,
  };
}

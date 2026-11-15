'use client';
import { useEffect, useRef, useState } from 'react';
import { rememberTake, readPendingTake, forgetTake } from '../../../_lib/music/beat/beatPendingTake.mjs';
import { createRecording, contextTimeToSongTick, takeAsNewBeat } from '../../../_lib/music/beat/beatRecording.mjs';
import { inputContextTime } from '../../../_lib/music/beat/beatWebMidi.mjs';
import { effectiveGain, editTrack } from '../../../_lib/music/beat/beatEvents.mjs';
export function useBeatMidi(current, edit, announce, engine, active, optionsRef, audio, terminate) {
  const pending = useRef(null), live = useRef(new Map()), mapping = useRef(null);
  const [overlay, setOverlay] = useState([]), [takeError, setTakeError] = useState('');
  const [quantise, setQuantise] = useState(false), [countIn, setCountIn] = useState(false);
  const [recordingRun, setRecordingRun] = useState(false);
  const restored = useRef(null);
  useEffect(() => {
    const doc = current.current;
    if (!doc || restored.current === doc.id) return;
    restored.current = doc.id;
    const saved = readPendingTake(doc.id);
    if (!saved) return;
    const capture = createRecording(doc, saved.trackId, saved.startTick, { snap: saved.snap, announce });
    Object.assign(capture.take, saved); pending.current = capture;
    mapping.current = { contextStart: 0, startTick: 0, tempo: doc.tempo.bpm };
    queueMicrotask(() => { setOverlay(saved.notes); setTakeError('A pending recording was recovered. Try again or save it as a new beat.'); });
  });
  function finalizeRecording() {
    const capture = pending.current;
    if (!capture || !current.current) return current.current;
    const tick = contextTimeToSongTick(mapping.current, engine.current?.now() ?? mapping.current.contextStart);
    const next = capture.finalize(current.current, tick, (doc, count) => edit(() => doc, { recordingCommit: true, label: `Recorded ${count} notes`, message: `Recorded ${count} notes` }));
    setRecordingRun(false);
    if (capture.error) {
      const saved = rememberTake(current.current.id, capture.take);
      setTakeError(`${capture.error}${saved ? '' : ' Recovery storage is unavailable; keep this page open.'}`);
    }
    else { forgetTake(current.current.id); pending.current = null; setOverlay([]); setTakeError(''); }
    return next;
  }
  function begin(map, startTick) {
    mapping.current = map;
    pending.current = createRecording(current.current, editTrack(current.current, optionsRef.current?.editTrackId).id, startTick,
      { snap: quantise ? optionsRef.current?.snap || 240 : 0, announce });
    setTakeError(''); setRecordingRun(true);
  }
  async function noteOn(key, pitch, velocity = 100, timeStamp) {
    if (live.current.has(key) || pitch < 21 || pitch > 108) return;
    try {
      const { instance, resumed } = audio();
      const track = editTrack(current.current, optionsRef.current?.editTrackId);
      if (track.kind !== 'midi') return;
      const marker = { voice: null }; live.current.set(key, marker);
      const at = inputContextTime(instance.context, timeStamp, performance.now());
      if (pending.current && active.current?.recording) {
        pending.current.on(key, pitch, velocity, contextTimeToSongTick(mapping.current, at));
        setOverlay([...pending.current.take.notes]);
      }
      await resumed;
      if (live.current.get(key) !== marker || engine.current !== instance) return;
      marker.voice = instance.playMidi(track, pitch, velocity, instance.now(), instance.live, effectiveGain(current.current, track.id, 'song'));
    } catch (e) { announce(e.message); terminate(); }
  }
  function noteOff(key, timeStamp) {
    const instance = engine.current, note = live.current.get(key);
    live.current.delete(key);
    if (!instance) return;
    note?.voice?.release(instance.now());
    if (pending.current && active.current?.recording) {
      pending.current.off(key, contextTimeToSongTick(mapping.current, inputContextTime(instance.context, timeStamp, performance.now())));
      setOverlay([...pending.current.take.notes]);
    }
  }
  function releaseKeys() { for (const key of live.current.keys()) noteOff(key); }
  function update(time) {
    if (pending.current && active.current?.recording) pending.current.update(contextTimeToSongTick(mapping.current, time));
  }
  function takeAsBeat() {
    if (!pending.current) return null;
    return takeAsNewBeat(current.current, pending.current.take, { id: crypto.randomUUID() });
  }
  function discardSavedTake() { forgetTake(current.current.id); pending.current = null; setTakeError(''); setOverlay([]); }
  return { pending, recordingRun, overlay, takeError, quantise, setQuantise, countIn, setCountIn,
    begin, noteOn, noteOff, releaseKeys, update, finalizeRecording, takeAsBeat, discardSavedTake };
}

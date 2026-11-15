'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createBeatEngine } from '../../../_lib/music/beat/beatEngine.js';
import { createScheduler } from '../../../_lib/music/beat/beatScheduler.mjs';
import { addHitToPattern } from '../../../_lib/music/beat/beatOps.mjs';
import { editTrack, recordTarget } from '../../../_lib/music/beat/beatEvents.mjs';
import { playbackStart, sequenceFor } from '../../../_lib/music/beat/beatSequence.mjs';

export function useBeatPlayback(current, edit, announce, options) {
  const engine = useRef(null);
  const gapAnnouncement = useRef(-Infinity);
  const optionsRef = useRef(options);
  useEffect(() => { optionsRef.current = options; }, [options]);
  const active = useRef(null);
  const tails = useRef(new Map());
  const pending = useRef(0);
  const starting = useRef(false);
  const mounted = useRef(true);
  const record = useRef(false);
  const [recording, setRecording] = useState(false);
  const [runId, setRunId] = useState(null);
  const [playhead, setPlayhead] = useState(-1);
  const [audioError, setAudioError] = useState(() => (window.AudioContext || window.webkitAudioContext) ? '' : "Sound isn't available in this browser");
  const stop = useCallback(() => {
    pending.current = null; starting.current = false;
    if (active.current) {
      active.current.scheduler.stop();
      engine.current.stopRun(active.current.run);
      active.current = null;
    }
    for (const run of tails.current.keys()) engine.current.stopRun(run);
    tails.current.clear();
    setRunId(null); setPlayhead(-1);
  }, []);
  function audio() {
    if (!engine.current) engine.current = createBeatEngine();
    // Called synchronously from a pointer/key gesture, including the first iOS resume.
    const resumed = engine.current.resume();
    return { instance: engine.current, resumed };
  }
  async function toggle() {
    if (active.current || starting.current) { stop(); return; }
    if (playbackStart(current.current, optionsRef.current?.locator || 0) === null) {
      announce('Nothing to play. Add a region first.');
      return;
    }
    // A separate token makes a late resume harmless after Stop or unmount.
    const token = {}; pending.current = token;
    starting.current = true;
    try {
      const { instance, resumed } = audio();
      await resumed;
      if (!mounted.current || pending.current !== token) return;
      starting.current = false;
      if (playbackStart(current.current, optionsRef.current?.locator || 0) === null) {
        announce('Nothing to play. Add a region first.');
        return;
      }
      const run = instance.startRun();
      const scheduled = [];
      const scheduler = createScheduler({
        clock: instance.now, setTimer: setTimeout, clearTimer: clearTimeout, isHidden: () => document.hidden,
        onEvent: (event, time) => {
          const track = editTrack(current.current, event.trackId);
          const destination = instance.setTrackMix(run, track.id, track.gain, track.pan);
          instance.playPad(event.pad, event.velocity, time, destination, track.kit);
        },
        onEnd: (time) => {
          if (active.current?.run === run) {
            active.current.endTime = time;
            active.current.endStep = sequenceFor(current.current).endStep;
          }
        },
        onStep: (step, time) => {
          const doc = current.current;
          const oldest = instance.now() - 2;
          while (scheduled.length && scheduled[0].time < oldest) scheduled.shift();
          scheduled.push({ step, time, run: run.id, pattern: doc.currentPattern });
          if (doc.metronome && step % 4 === 0) instance.click(time, step % 16 === 0, run.bus);
        },
      });
      scheduler.updateSequence(() => sequenceFor(current.current,
        optionsRef.current?.locator || 0, optionsRef.current?.editTrackId));
      active.current = { run, scheduler, scheduled };
      scheduler.start(instance.now() + 0.03);
      setAudioError(''); setRunId(run.id);
    } catch (failure) {
      if (!mounted.current || pending.current !== token) return;
      starting.current = false;
      const message = failure.message || "Sound isn't available in this browser";
      setAudioError(message); announce(message);
    }
  }
  async function hit(pad) {
    try {
      const { instance, resumed } = audio();
      const tappedAt = instance.now();
      const tappedRun = active.current;
      // Recording uses actual scheduled audio times, including queued tempo/swing edits.
      if (record.current && tappedRun) {
        tappedRun.scheduler.refill();
        const nearest = tappedRun.scheduler.nearestStepAt(tappedAt);
        const target = nearest && recordTarget(current.current, nearest.step, optionsRef.current?.editTrackId);
        if (target) edit((d) => addHitToPattern(d, target.pattern, pad, target.step), { label: 'record hit' });
        else if (instance.now() - gapAnnouncement.current >= 2) {
          gapAnnouncement.current = instance.now();
          announce(`No region under the playhead on ${editTrack(current.current, optionsRef.current?.editTrackId).name}`);
        }
      }
      await resumed;
      if (!mounted.current) return;
      instance.playPad(pad, 100 / 127, instance.now(), instance.master, editTrack(current.current, optionsRef.current?.editTrackId).kit);
    } catch (failure) { setAudioError(failure.message); announce(failure.message); }
  }
  function setRecord(value) { record.current = value; setRecording(value); }
  useEffect(() => {
    mounted.current = true;
    const ringing = tails.current;
    let frame;
    function animate() {
      for (const [run, endTime] of ringing) {
        if (engine.current && engine.current.now() >= endTime + 1.5) {
          engine.current.stopRun(run);
          ringing.delete(run);
        }
      }
      const playing = active.current;
      if (playing && engine.current) {
        const instance = engine.current;
        const audible = instance.now() - (instance.context.outputLatency || instance.context.baseLatency || 0);
        for (const track of current.current.tracks) instance.setTrackMix(playing.run, track.id, track.gain, track.pan);
        if (playing.endTime !== undefined && audible >= playing.endTime) {
          playing.scheduler.stop();
          ringing.set(playing.run, playing.endTime);
          active.current = null;
          setRunId(null); setPlayhead(playing.endStep);
          frame = requestAnimationFrame(animate);
          return;
        }
        let latest;
        for (const step of playing.scheduled) if (step.run === playing.run.id && step.time <= audible) latest = step;
        if (latest) setPlayhead(latest.step);
        // Keep recent times for nearest-step recording, as well as all future times.
        while (playing.scheduled.length > 1 && playing.scheduled[1].time < audible - 2) playing.scheduled.shift();
      }
      frame = requestAnimationFrame(animate);
    }
    function visibility() { if (document.hidden) active.current?.scheduler.refill(); }
    frame = requestAnimationFrame(animate);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      mounted.current = false; pending.current = null; starting.current = false;
      cancelAnimationFrame(frame); document.removeEventListener('visibilitychange', visibility);
      active.current?.scheduler.stop(); active.current = null;
      ringing.clear();
      engine.current?.close().catch(() => {}); engine.current = null;
    };
  }, [current, stop]);
  return { playing: runId !== null, runId, playhead, audioError, toggle, hit, stop, record: recording, setRecord };
}

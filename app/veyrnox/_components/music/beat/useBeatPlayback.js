'use client';
import { mixSignature } from '../../../_lib/music/beat/beatMixGraph.js';
import { mixTailSeconds } from '../../../_lib/music/beat/beatMixRules.mjs';
import { playbackHoldObserver } from '../../../_lib/music/beat/beatAssetAvailability.mjs';
import { useBeatMidi } from './useBeatMidi';
import { effectiveGain } from '../../../_lib/music/beat/beatEvents.mjs';
import { recordingSequence } from '../../../_lib/music/beat/beatRecording.mjs';
import { assetState, subscribeAssets, cachedAsset, loadAsset, syncAssetTempo, assetKey } from '../../../_lib/music/beat/beatAssets.js';
import { arrangementStructure, lateAudioSegment, playbackAssets } from '../../../_lib/music/beat/beatPlaybackAudio.mjs';
import { playAudioSegment } from '../../../_lib/music/beat/beatAudioGraph.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createBeatEngine } from '../../../_lib/music/beat/beatEngine.js';
import { createScheduler } from '../../../_lib/music/beat/beatScheduler.mjs';
import { addHitToPattern } from '../../../_lib/music/beat/beatOps.mjs';
import { editTrack, patternTrack, recordTarget } from '../../../_lib/music/beat/beatEvents.mjs';
import { playbackStart, sequenceFor } from '../../../_lib/music/beat/beatSequence.mjs';

export function useBeatPlayback(current, edit, announce, options) {
  const engine = useRef(null);
  const gapAnnouncement = useRef(-Infinity);
  const optionsRef = useRef(options);
  useEffect(() => { optionsRef.current = options; }, [options]);
  const active = useRef(null);
  const isRecording = useCallback(() => Boolean(active.current?.recording), []);
  const tails = useRef(new Map());
  const pending = useRef(0);
  const starting = useRef(false);
  const mounted = useRef(true);
  const record = useRef(false);
  const [recording, setRecording] = useState(false);
  const [runId, setRunId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [playhead, setPlayhead] = useState(-1);
  const [audioError, setAudioError] = useState(() => (window.AudioContext || window.webkitAudioContext) ? '' : "Sound isn't available in this browser");
  const midi = useBeatMidi(current, edit, announce, engine, active, optionsRef, audio, terminate);
  const midiRef = useRef(midi);
  useEffect(() => { midiRef.current = midi; }, [midi]);
  const stop = useCallback(() => {
    const finalized = midiRef.current.finalizeRecording();
    pending.current = null; starting.current = false;
    if (active.current) {
      active.current.scheduler.stop();
      engine.current.stopRun(active.current.run);
      active.current = null;
    }
    for (const run of tails.current.keys()) engine.current.stopRun(run);
    tails.current.clear();
    setRunId(null); setPlayhead(-1); setLoading(false);
    return finalized;
  }, []);
  useEffect(() => subscribeAssets(playbackHoldObserver({ current: () => current.current, state: assetState,
    playing: () => !!(active.current || starting.current), stop, announce })), [current, stop, announce]);
  function terminate() { stop(); }
  function audio() {
    if (!engine.current) engine.current = createBeatEngine();
    // Called synchronously from a pointer/key gesture, including the first iOS resume.
    engine.current.context.onstatechange = () => {
      if (engine.current?.context.state !== 'running' && active.current?.recording) { stop(); announce('Recording stopped because the audio context was interrupted.'); }
    };
    const resumed = engine.current.resume();
    return { instance: engine.current, resumed };
  }
  async function toggle() {
    if (active.current || starting.current) { stop(); return; }
    const isRecording = record.current && editTrack(current.current, optionsRef.current?.editTrackId).kind === 'midi';
    if (midi.pending.current) { announce('Save or retry the pending take before playing.'); return; }
    if (!isRecording && playbackStart(current.current, optionsRef.current?.locator || 0) === null) {
      announce('Nothing to play. Add a region first.');
      return;
    }
    // A separate token makes a late resume harmless after Stop or unmount.
    const token = {}; pending.current = token;
    starting.current = true;
    setLoading(true);
    try {
      const { instance, resumed } = audio();
      await resumed;
      if (!mounted.current || pending.current !== token) return;
      // Edits remain available while loading. Recheck the latest play range before starting.
      while (true) {
        const doc = current.current, locator = optionsRef.current?.locator || 0;
        syncAssetTempo(doc.tempo.bpm);
        await Promise.all(playbackAssets(isRecording ? { ...doc, view: 'song', cycle: { ...doc.cycle, on: false } } : doc, locator).map(({ asset, reverse }) => loadAsset(asset, doc.tempo.bpm, reverse)));
        if (!mounted.current || pending.current !== token) return;
        if (doc === current.current && locator === (optionsRef.current?.locator || 0)) break;
      }
      starting.current = false;
      setLoading(false);
      if (!isRecording && playbackStart(current.current, optionsRef.current?.locator || 0) === null) {
        announce('Nothing to play. Add a region first.');
        return;
      }
      let run = instance.startRun(current.current, { automationActive: isRecording || current.current.view === 'song', onError: message => { setAudioError(message); announce(message); } });
      const scheduled = [];
      const getSequence = () => isRecording ? recordingSequence(current.current, optionsRef.current?.locator || 0, midi.countIn)
        : sequenceFor(current.current, optionsRef.current?.locator || 0, optionsRef.current?.editTrackId, optionsRef.current?.selectedRegionId);
      const gain = (doc, track) => effectiveGain(doc, track.id, isRecording ? 'song' : doc.view);
      const scheduler = createScheduler({
        clock: instance.now, setTimer: setTimeout, clearTimer: clearTimeout, isHidden: () => document.hidden,
        onWindow: window => {
          const doc = current.current;
          if (isRecording || doc.view === 'song') for (const track of doc.tracks) {
            instance.setTrackMix(run, track.id, gain(doc, track), track.pan, doc);
            run.channels.get(track.id)?.schedule?.(window);
          }
        },
        onAudio: (segment, time) => {
          const doc = current.current, asset = doc.assets[segment.assetId];
          const buffer = asset && cachedAsset(asset, doc.tempo.bpm, segment.reverse);
          if (!asset) return;
          const track = doc.tracks.find((t) => t.id === segment.trackId);
          const region = track?.regions.find((r) => r.id === segment.regionId);
          if (!region) return;
          if (!buffer) {
            const scheduledRun = run;
            void loadAsset(asset, doc.tempo.bpm, segment.reverse).then((loaded) => {
              const latest = current.current;
              if (!loaded || active.current?.run !== scheduledRun || latest.tempo.bpm !== doc.tempo.bpm
                || arrangementStructure(latest) !== arrangementStructure(doc)
                || assetKey(latest.assets[segment.assetId], latest.tempo.bpm) !== assetKey(asset, doc.tempo.bpm)) return;
              const latestTrack = latest.tracks.find((t) => t.id === segment.trackId);
              const latestRegion = latestTrack.regions.find((r) => r.id === segment.regionId);
              if (latestRegion.reverse !== segment.reverse) return;
              const now = instance.now(), remainder = lateAudioSegment(segment, time, now);
              if (remainder) playAudioSegment(instance.context,
                instance.setTrackMix(scheduledRun, latestTrack.id, gain(latest, latestTrack), latestTrack.pan, latest),
                loaded, remainder, latestRegion, latest.tempo.bpm, Math.max(time, now));
            });
            return;
          }
          playAudioSegment(instance.context, instance.setTrackMix(run, track.id, gain(doc, track), track.pan, doc), buffer, segment, region, doc.tempo.bpm, time);
        },
        onMidi: (note, time) => {
          const doc = current.current, track = doc.tracks.find((t) => t.id === note.trackId);
          try {
            run.doc = doc;
            if (track) instance.playMidi(track, note.pitch, note.velocity, time, run, gain(doc, track)).release(time + note.durationSec);
          } catch (failure) { setAudioError(failure.message); announce(failure.message); }
        },
        onEvent: (event, time) => {
          const track = editTrack(current.current, event.trackId);
          const destination = instance.setTrackMix(run, track.id, gain(current.current, track), track.pan, current.current);
          instance.playPad(event.pad, event.velocity, time, destination, track.kit);
        },
        onEnd: (time) => {
          if (active.current?.run === run) {
            active.current.endTime = time;
            active.current.endStep = getSequence().endStep;
          }
        },
        onStep: (step, time) => {
          const doc = current.current;
          const oldest = instance.now() - 2;
          while (scheduled.length && scheduled[0].time < oldest) scheduled.shift();
          scheduled.push({ step, time, run: run.id, pattern: doc.currentPattern });
          if ((doc.metronome || (isRecording && step * 240 < (optionsRef.current?.locator || 0))) && step % 4 === 0) instance.click(time, step % 16 === 0, run.master?.input || run.bus);
        },
      });
      scheduler.updateSequence(getSequence);
      active.current = { run, scheduler, scheduled, recording: isRecording, doc: current.current, restart(tick) {
        scheduler.stop(); instance.stopRun(run); run = instance.startRun(current.current, { automationActive: isRecording || current.current.view === 'song', onError: message => { setAudioError(message); announce(message); } }); scheduled.length = 0;
        active.current.run = run; active.current.endTime = undefined;
        scheduler.updateSequence(() => sequenceFor(current.current, tick, optionsRef.current?.editTrackId, optionsRef.current?.selectedRegionId));
        scheduler.start(instance.now() + 0.03); setRunId(run.id);
      } };
      const contextStart = instance.now() + 0.03;
      if (isRecording) {
        midi.begin({ contextStart, startTick: getSequence().startStep * 240, tempo: current.current.tempo.bpm }, getSequence().recordStart);
        document.querySelector('[aria-label="Transport"] button[data-beat-live]')?.focus();
      }
      scheduler.start(contextStart);
      if (!run.mix?.errors.length) setAudioError(''); setRunId(run.id);
    } catch (failure) {
      if (!mounted.current || pending.current !== token) return;
      stop();
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
      if (!mounted.current || engine.current !== instance) return;
      instance.playPad(pad, 100 / 127, instance.now(), instance.master, patternTrack(current.current, optionsRef.current?.editTrackId)?.kit || '808');
    } catch (failure) { setAudioError(failure.message); announce(failure.message); }
  }
  function setRecord(value) { record.current = value; setRecording(value); }
  useEffect(() => {
    mounted.current = true;
    const ringing = tails.current;
    let frame;
    function animate() {
      for (const [run, endTime] of ringing) {
        if (engine.current && engine.current.now() >= endTime + mixTailSeconds(run.doc || current.current)) {
          engine.current.stopRun(run);
          ringing.delete(run);
        }
      }
      if (engine.current && current.current) for (const track of current.current.tracks) {
        engine.current.setTrackMix(engine.current.live, track.id, effectiveGain(current.current, track.id, 'song'), track.pan);
        for (const run of ringing.keys()) engine.current.setTrackMix(run, track.id, effectiveGain(current.current, track.id, current.current.view), track.pan);
      }
      const playing = active.current;
      if (playing && engine.current) {
        const instance = engine.current;
        const doc = current.current;
        syncAssetTempo(doc.tempo.bpm);
        if (playing.doc !== doc) {
          // Restart edited arrangements through the existing 10 ms run fade.
          const old = playing.doc;
          const changed = old.tempo.bpm !== doc.tempo.bpm || old.view !== doc.view || JSON.stringify(old.cycle) !== JSON.stringify(doc.cycle) || arrangementStructure(old) !== arrangementStructure(doc) || mixSignature(old) !== mixSignature(doc);
          if (changed && !playing.recording) {
            const nearest = playing.scheduler.nearestStepAt(instance.now());
            playing.restart((nearest?.step ?? 0) * 240);
            playing.doc = doc;
            frame = requestAnimationFrame(animate); return;
          }
          playing.doc = doc;
        }
        midiRef.current.update(instance.now());
        const audible = instance.now() - (instance.context.outputLatency || instance.context.baseLatency || 0);
        for (const track of current.current.tracks) {
          instance.setTrackMix(playing.run, track.id, effectiveGain(doc, track.id, playing.recording ? 'song' : doc.view), track.pan, doc);
        }
        if (playing.endTime !== undefined && audible >= playing.endTime) {
          if (playing.recording) { stop(); announce('Recording reached the project time limit.'); frame = requestAnimationFrame(animate); return; }
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
    function pagehide() {
      stop(); midiRef.current.releaseKeys();
      engine.current?.close().catch(() => {}); engine.current = null;
    }
    window.addEventListener('pagehide', pagehide);
    frame = requestAnimationFrame(animate);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      window.removeEventListener('pagehide', pagehide);
      midiRef.current.finalizeRecording(); midiRef.current.releaseKeys();
      mounted.current = false; pending.current = null; starting.current = false;
      cancelAnimationFrame(frame); document.removeEventListener('visibilitychange', visibility);
      active.current?.scheduler.stop(); active.current = null;
      ringing.clear();
      engine.current?.close().catch(() => {}); engine.current = null;
    };
  }, [current, stop, announce]);
  return { ...midi, engine, isRecording, playing: runId !== null, loading, runId, playhead, audioError, toggle, hit, stop, record: recording, setRecord };
}

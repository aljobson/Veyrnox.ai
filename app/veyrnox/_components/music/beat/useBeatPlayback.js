'use client';
import { cachedAsset, loadAsset, syncAssetTempo, assetKey } from '../../../_lib/music/beat/beatAssets.js';
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
  const stop = useCallback(() => {
    pending.current = null; starting.current = false;
    if (active.current) {
      active.current.scheduler.stop();
      engine.current.stopRun(active.current.run);
      active.current = null;
    }
    for (const run of tails.current.keys()) engine.current.stopRun(run);
    tails.current.clear();
    setRunId(null); setPlayhead(-1); setLoading(false);
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
    setLoading(true);
    try {
      const { instance, resumed } = audio();
      await resumed;
      if (!mounted.current || pending.current !== token) return;
      // Edits remain available while loading. Recheck the latest play range before starting.
      while (true) {
        const doc = current.current, locator = optionsRef.current?.locator || 0;
        syncAssetTempo(doc.tempo.bpm);
        await Promise.all(playbackAssets(doc, locator).map(({ asset, reverse }) => loadAsset(asset, doc.tempo.bpm, reverse)));
        if (!mounted.current || pending.current !== token) return;
        if (doc === current.current && locator === (optionsRef.current?.locator || 0)) break;
      }
      starting.current = false;
      setLoading(false);
      if (playbackStart(current.current, optionsRef.current?.locator || 0) === null) {
        announce('Nothing to play. Add a region first.');
        return;
      }
      let run = instance.startRun();
      const scheduled = [];
      const scheduler = createScheduler({
        clock: instance.now, setTimer: setTimeout, clearTimer: clearTimeout, isHidden: () => document.hidden,
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
                instance.setTrackMix(scheduledRun, latestTrack.id, latestTrack.gain, latestTrack.pan),
                loaded, remainder, latestRegion, latest.tempo.bpm, Math.max(time, now));
            });
            return;
          }
          playAudioSegment(instance.context, instance.setTrackMix(run, track.id, track.gain, track.pan), buffer, segment, region, doc.tempo.bpm, time);
        },
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
      active.current = { run, scheduler, scheduled, doc: current.current, restart(tick) {
        scheduler.stop(); instance.stopRun(run); run = instance.startRun(); scheduled.length = 0;
        active.current.run = run; active.current.endTime = undefined;
        scheduler.updateSequence(() => sequenceFor(current.current, tick, optionsRef.current?.editTrackId));
        scheduler.start(instance.now() + 0.03); setRunId(run.id);
      } };
      scheduler.start(instance.now() + 0.03);
      setAudioError(''); setRunId(run.id);
    } catch (failure) {
      if (!mounted.current || pending.current !== token) return;
      starting.current = false;
      setLoading(false);
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
        if (engine.current && engine.current.now() >= endTime + 1.5) {
          engine.current.stopRun(run);
          ringing.delete(run);
        }
      }
      const playing = active.current;
      if (playing && engine.current) {
        const instance = engine.current;
        const doc = current.current;
        syncAssetTempo(doc.tempo.bpm);
        if (playing.doc !== doc) {
          // Restart edited arrangements through the existing 10 ms run fade.
          const old = playing.doc;
          const changed = old.tempo.bpm !== doc.tempo.bpm || old.view !== doc.view || JSON.stringify(old.cycle) !== JSON.stringify(doc.cycle) || arrangementStructure(old) !== arrangementStructure(doc);
          if (changed) {
            const nearest = playing.scheduler.nearestStepAt(instance.now());
            playing.restart((nearest?.step ?? 0) * 240);
            playing.doc = doc;
            frame = requestAnimationFrame(animate); return;
          }
          playing.doc = doc;
        }
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
    function pagehide() {
      stop();
      engine.current?.close().catch(() => {}); engine.current = null;
    }
    window.addEventListener('pagehide', pagehide);
    frame = requestAnimationFrame(animate);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      window.removeEventListener('pagehide', pagehide);
      mounted.current = false; pending.current = null; starting.current = false;
      cancelAnimationFrame(frame); document.removeEventListener('visibilitychange', visibility);
      active.current?.scheduler.stop(); active.current = null;
      ringing.clear();
      engine.current?.close().catch(() => {}); engine.current = null;
    };
  }, [current, stop]);
  return { playing: runId !== null, loading, runId, playhead, audioError, toggle, hit, stop, record: recording, setRecord };
}

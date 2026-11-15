'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { gatewayFetch } from '../../../_lib/gateway';
import { loopSeconds, readLayers, writeLayers } from '../../../_lib/music/beat/magicBar.mjs';

/**
 * Magic loop layers for one beat: kept beside the beat, decoded once, looped at
 * exactly their bar length, started and stopped with the beat transport.
 */
export function useBeatLoopLayers(beatId, playing) {
  const [layers, setLayers] = useState(() => readLayers(beatId));
  const context = useRef(null);
  const buffers = useRef(new Map());
  const sources = useRef([]);
  const [error, setError] = useState('');

  const save = useCallback((next) => { setLayers(next); writeLayers(beatId, next); }, [beatId]);

  const stopAll = useCallback(() => {
    for (const source of sources.current) { try { source.stop(); } catch { /* already stopped */ } }
    sources.current = [];
  }, []);

  const load = useCallback(async (layer) => {
    if (buffers.current.has(layer.songId)) return buffers.current.get(layer.songId);
    const signed = await gatewayFetch(layer.audioUrl.replace(/^\/api\/v1/, ''));
    const response = await fetch(signed.url);
    if (!response.ok) throw new Error('fetch');
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!context.current) context.current = new Context();
    const buffer = await context.current.decodeAudioData(await response.arrayBuffer());
    buffers.current.set(layer.songId, buffer);
    return buffer;
  }, []);

  useEffect(() => {
    if (!playing) { stopAll(); return undefined; }
    let live = true;
    const audible = layers.filter((layer) => !layer.muted);
    if (!audible.length) return undefined;
    Promise.all(audible.map(async (layer) => ({ layer, buffer: await load(layer) })))
      .then(async (ready) => {
        if (!live) return;
        await context.current.resume();
        const at = context.current.currentTime + 0.05;
        for (const { layer, buffer } of ready) {
          const source = context.current.createBufferSource();
          source.buffer = buffer; source.loop = true; source.loopStart = 0;
          source.loopEnd = Math.min(buffer.duration, loopSeconds(layer.bpm, layer.bars));
          source.connect(context.current.destination);
          source.start(at);
          sources.current.push(source);
        }
        setError('');
      })
      .catch(() => { if (live) setError('A Magic loop could not be loaded. The beat plays without it.'); });
    return () => { live = false; stopAll(); };
  }, [playing, layers, load, stopAll]);

  useEffect(() => () => { stopAll(); context.current?.close?.(); }, [stopAll]);

  return {
    layers, error,
    add: (layer) => save([...layers.filter((item) => item.songId !== layer.songId), layer]),
    toggleMute: (songId) => save(layers.map((item) => (item.songId === songId ? { ...item, muted: !item.muted } : item))),
    remove: (songId) => save(layers.filter((item) => item.songId !== songId)),
  };
}

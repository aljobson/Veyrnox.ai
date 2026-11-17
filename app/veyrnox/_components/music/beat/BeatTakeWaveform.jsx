'use client';
import { useEffect, useRef } from 'react';
import { loadAsset, audioPeaks } from '../../../_lib/music/beat/beatAssets.js';
import { tickSeconds } from '../../../_lib/music/beat/beatAudioSegments.mjs';
export default function BeatTakeWaveform({ asset, bpm, length }) {
  const canvas = useRef(null);
  useEffect(() => {
    let active = true;
    void loadAsset(asset, bpm).then(async buffer => {
      if (!buffer) return;
      const peaks = await audioPeaks(buffer);
      if (!active || !canvas.current) return;
      const node = canvas.current, context = node.getContext('2d');
      node.width = Math.max(1, Math.min(2048, Math.round(node.getBoundingClientRect().width))); node.height = 40;
      context.strokeStyle = getComputedStyle(node).color; context.beginPath();
      for (let x = 0; x < node.width; x++) {
        const time = x / node.width * tickSeconds(length, bpm);
        if (time >= asset.durationSec) break;
        const peak = peaks[Math.min(peaks.length - 1, Math.floor(time / asset.durationSec * peaks.length))];
        context.moveTo(x, 20 - peak * 18); context.lineTo(x, 20 + peak * 18);
      }
      context.stroke();
    });
    return () => { active = false; };
  }, [asset, bpm, length]);
  return <canvas ref={canvas} aria-hidden="true" className="pointer-events-none h-full w-full text-vx-hue-sky" />;
}

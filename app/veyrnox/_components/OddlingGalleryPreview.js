'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import styles from './OddlingGalleryPreview.module.css';
import { puppetRig } from '../_lib/oddlingPuppetRigs';
import { createOddlingPuppet } from '../_lib/oddlingPuppetRenderer';

function subscribeEnvironment(notify) {
  const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
  document.addEventListener('visibilitychange', notify);
  preference.addEventListener('change', notify);
  return () => {
    document.removeEventListener('visibilitychange', notify);
    preference.removeEventListener('change', notify);
  };
}

export function useGalleryMotionAllowed() {
  return useSyncExternalStore(subscribeEnvironment,
    () => !document.hidden && !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    () => false);
}

function PuppetCanvas({ id, playing }) {
  const canvas = useRef(null);
  const control = useRef(null);
  const requested = useRef(playing);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    requested.current = playing;
    control.current?.setPlaying(playing);
  }, [playing]);
  useEffect(() => {
    const element = canvas.current;
    const rig = puppetRig(id);
    if (!element || !rig) return;
    let disposed = false, renderer = null, animation = null, active = false;
    let elapsed = 0, previous = null, lastDraw = 0;
    function stop() {
      active = false;
      if (animation !== null) cancelAnimationFrame(animation);
      animation = null; previous = null;
    }
    function frame(timestamp) {
      animation = null;
      if (!active || disposed) return;
      if (previous !== null) elapsed += Math.min(100, timestamp - previous) / 1000;
      previous = timestamp;
      if (timestamp - lastDraw >= 32) {
        if (!renderer.render(elapsed)) { stop(); setReady(false); setFailed(true); return; }
        lastDraw = timestamp;
      }
      animation = requestAnimationFrame(frame);
    }
    function setPlaying(value) {
      if (!value) { stop(); return; }
      if (!active && renderer && !disposed) {
        active = true;
        animation = requestAnimationFrame(frame);
      }
    }
    function fail() { if (!disposed) { stop(); setReady(false); setFailed(true); } }
    const image = new window.Image();
    image.decoding = 'async';
    image.onload = () => {
      if (disposed) return;
      try {
        renderer = createOddlingPuppet(element, image, id, rig);
        if (!renderer.render(0)) throw new Error('puppet_context_lost');
        control.current = { setPlaying };
        setReady(true);
        setPlaying(requested.current);
      } catch { fail(); }
    };
    image.onerror = fail;
    element.addEventListener('webglcontextlost', fail);
    image.src = `/oddlings/portraits/${id}.webp`;
    return () => {
      disposed = true; stop(); control.current = null;
      image.onload = null; image.onerror = null;
      element.removeEventListener('webglcontextlost', fail);
      renderer?.destroy();
    };
  }, [id]);
  return <>
    <canvas ref={canvas} width={512} height={768} aria-hidden="true"
      data-testid={`oddling-puppet-${id}`} data-rig-id={id}
      data-puppet-state={failed ? 'unavailable' : ready ? (playing ? 'running' : 'paused') : 'loading'}
      className={`${styles.canvas} ${ready ? styles.ready : ''}`} />
    {failed && <span className={styles.fallback}>Static portrait · graphics preview unavailable</span>}
  </>;
}

// Presentation only: no generation, upload, audio, or credit-bearing action.
export function OddlingGalleryPreview({ id, playing, children }) {
  const frame = useRef(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!frame.current || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0.05 });
    observer.observe(frame.current);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={frame} data-testid={`oddling-preview-${id}`} data-preview-running={playing && visible}
      className="flex aspect-[4/5] items-center justify-center overflow-hidden bg-vx-base">
      <div className={styles.portrait}>
        {children}
        {visible && puppetRig(id) && <PuppetCanvas id={id} playing={playing && visible} />}
      </div>
    </div>
  );
}

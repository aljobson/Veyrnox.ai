'use client';

import Link from 'next/link';
import Script from 'next/script';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Button } from '../../../_components/Button';
import { getSession, onSessionChange } from '../../../../lib/authClient';
import { gatewayFetch } from '../../../_lib/gateway';
import { createPlaybackMeter } from '../../../../../lib/cinema/playbackMeter';

const identity = () => getSession()?.user?.id || '';
const noIdentity = () => '';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CUSTOMER_CODE = /^[a-z0-9]{1,64}$/;
const HEARTBEAT_SECONDS = 30;
// A playback token lives 15 minutes; ask for the next one before it lapses.
const RENEW_BEFORE_MS = 3 * 60 * 1000;

/**
 * Plays one title through Cloudflare Stream's player. The page mints a signed
 * playback token from /api/v1/cinema/play (only an entitled viewer gets one),
 * renews it during active playback, and meters visible playback with Stream
 * media events rather than the time the watch page is open. The server records
 * those for Cinema Pass viewing and, with the monthly ceiling on, free titles.
 */
export function Player({ id }) {
  const account = useSyncExternalStore(onSessionChange, identity, noIdentity);
  const [state, setState] = useState('loading');
  const [src, setSrc] = useState('');
  const [reason, setReason] = useState('');
  const frame = useRef(null);
  const stream = useRef(null);
  const renewal = useRef(null);
  const resume = useRef(null);
  const [scriptNonce, setScriptNonce] = useState('');
  const [sdkReady, setSdkReady] = useState(false);

  useEffect(() => {
    // Client navigation has a new server nonce but retains the current document
    // policy. Use the nonce already attached to its trusted framework scripts.
    setScriptNonce(document.querySelector('script[nonce]')?.nonce || '');
  }, []);

  useEffect(() => {
    let active = true;
    setSrc(''); setReason(''); setState('loading');
    if (!UUID.test(id)) { setState('missing'); return undefined; }
    if (!account) { setState('signin'); return undefined; }
    if (!sdkReady) return undefined;
    let minting = false;
    let expires = 0;
    const mint = async () => {
      if (minting) return;
      minting = true;
      try {
        const r = await gatewayFetch('/cinema/play', { method: 'POST', body: JSON.stringify({ content_id: id }) });
        if (!active) return;
        if (!CUSTOMER_CODE.test(r.customer_code || '') || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(r.token || '')) { setState('error'); return; }
        expires = Date.parse(r.expires_at);
        if (!Number.isFinite(expires)) { setState('error'); return; }
        if (stream.current) resume.current = { time: stream.current.currentTime, playing: !stream.current.paused && !stream.current.ended };
        // Only Stream's own host, built from the server's customer code and token, ever reaches the frame.
        setSrc(`https://customer-${r.customer_code}.cloudflarestream.com/${r.token}/iframe?preload=true`);
        setState('playing');
      } catch (err) {
        if (!active) return;
        setReason(err?.code === 'locked' ? (['free_ceiling', 'pass_ceiling'].includes(err?.body?.reason) ? err.body.reason : 'locked') : err?.code === 'not_ready' ? 'not_ready' : err?.code === 'content_not_found' ? 'missing' : err?.status === 503 ? 'closed' : 'error');
        setState('blocked');
      } finally { minting = false; }
    };
    mint();
    renewal.current = () => { if (Date.now() >= expires - RENEW_BEFORE_MS) void mint(); };
    return () => { active = false; renewal.current = null; resume.current = null; };
  }, [id, account, sdkReady]);

  useEffect(() => {
    if (state !== 'playing' || !src || !sdkReady || !frame.current) return undefined;
    let active = true;
    const player = window.Stream(frame.current);
    stream.current = player;
    const meter = createPlaybackMeter();
    meter.setVisible(document.visibilityState === 'visible');
    let sending = false;
    const flush = () => {
      if (!active || sending) return;
      const seconds = meter.takeSeconds();
      if (!seconds) return;
      sending = true;
      gatewayFetch('/cinema/play/heartbeat', { method: 'POST', body: JSON.stringify({ content_id: id, seconds }) })
        .then((h) => { if (active && ['pass_ceiling', 'free_ceiling'].includes(h.reason)) { setReason(h.reason); setState('blocked'); } })
        .catch(() => { /* a missed heartbeat is not an error the viewer can act on */ })
        .finally(() => { sending = false; });
    };
    const started = () => {
      if (document.visibilityState !== 'visible') { player.pause(); return; }
      meter.setPlaying(true); renewal.current?.();
    };
    const stopped = () => { meter.setPlaying(false); flush(); };
    const visibility = () => {
      const visible = document.visibilityState === 'visible';
      meter.setVisible(visible);
      // Hidden playback still costs Stream delivery even without a heartbeat.
      if (!visible) { player.pause(); flush(); }
    };
    const loaded = () => {
      const prior = resume.current;
      resume.current = null;
      if (!prior) return;
      player.currentTime = prior.time;
      if (prior.playing) void player.play().catch(() => { /* the viewer can press Play */ });
    };
    player.addEventListener('play', () => { if (document.visibilityState === 'visible') renewal.current?.(); });
    player.addEventListener('playing', started);
    for (const event of ['pause', 'ended', 'waiting', 'seeking', 'error', 'abort', 'emptied']) player.addEventListener(event, stopped);
    player.addEventListener('loadedmetadata', loaded);
    document.addEventListener('visibilitychange', visibility);
    const timer = setInterval(() => {
      if (player.paused || player.ended || player.seeking) meter.setPlaying(false);
      flush();
      if (meter.isPlaying()) renewal.current?.();
    }, HEARTBEAT_SECONDS * 1000);
    return () => {
      // Do not leave a watch-page interval behind on block, account switch or navigation.
      active = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', visibility);
      player.destroy();
      if (stream.current === player) stream.current = null;
    };
  }, [id, account, src, state, sdkReady]);

  const back = <p className="mt-6 text-sm"><Link href={`/social-cinema/title/${id}`} className="underline">Back to the title</Link> · <Link href="/social-cinema" className="underline">Social Cinema</Link></p>;
  const copy = { locked: 'This episode is locked. Unlock it from the title page or get a Cinema Pass.', not_ready: 'This video is still being prepared. Try again in a few minutes.', missing: 'This title is not available.', closed: 'Social Cinema viewing is not open yet.', pass_ceiling: 'Your Cinema Pass has reached its viewing limit for this month. You can still unlock episodes with credits.', free_ceiling: 'You have reached the free viewing limit for this month. Free viewing starts again next month.', error: 'Playback is unavailable right now. Try again in a moment.' };

  return <>{scriptNonce && account && <Script src="https://embed.cloudflarestream.com/embed/sdk.latest.js" nonce={scriptNonce || undefined} onReady={() => setSdkReady(typeof window.Stream === 'function')} onError={() => setState('error')} />}
  <div className="mx-auto max-w-[1300px] px-4 py-8 pb-40 sm:px-6 sm:pb-32"><div className="max-w-[952px]">
    {state === 'playing' ? <div className="aspect-[9/16] w-full max-w-[420px] overflow-hidden rounded-2xl border border-vx-border bg-black mx-auto sm:aspect-video sm:max-w-none">
      <iframe ref={frame} title="Now playing" src={src} allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture" allowFullScreen className="h-full w-full" />
    </div> : state === 'loading' ? <p role="status" className="text-vx-fg-muted">Preparing playback…</p>
      : state === 'signin' ? <div><p className="mb-4 text-vx-fg-body">Sign in to watch.</p><Button onClick={() => window.dispatchEvent(new CustomEvent('veyrnox:auth-required'))}>Sign in</Button></div>
        : <p role="status">{copy[state === 'blocked' ? reason : state] || copy.error}</p>}
    {back}
  </div></div></>;
}

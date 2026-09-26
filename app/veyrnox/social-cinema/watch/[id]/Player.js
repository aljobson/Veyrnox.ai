'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Button } from '../../../_components/Button';
import { getSession, onSessionChange } from '../../../../lib/authClient';
import { gatewayFetch } from '../../../_lib/gateway';

const identity = () => getSession()?.user?.id || '';
const noIdentity = () => '';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CUSTOMER_CODE = /^[a-z0-9]{1,64}$/;
const HEARTBEAT_SECONDS = 30;
// A playback token lives 15 minutes; ask for the next one before it lapses.
const RENEW_MS = 12 * 60 * 1000;

/**
 * Plays one title through Cloudflare Stream's player. The page mints a signed
 * playback token from /api/v1/cinema/play (only an entitled viewer gets one),
 * renews it before it expires, and while the tab is visible sends a heartbeat
 * every 30 seconds; the server only records those for Cinema Pass viewing.
 */
export function Player({ id }) {
  const account = useSyncExternalStore(onSessionChange, identity, noIdentity);
  const [state, setState] = useState('loading');
  const [src, setSrc] = useState('');
  const [reason, setReason] = useState('');
  const timers = useRef([]);

  useEffect(() => {
    let active = true;
    timers.current.forEach(clearInterval); timers.current = [];
    if (!UUID.test(id)) { setState('missing'); return undefined; }
    if (!account) { setState('signin'); return undefined; }
    const mint = async () => {
      try {
        const r = await gatewayFetch('/cinema/play', { method: 'POST', body: JSON.stringify({ content_id: id }) });
        if (!active) return;
        if (!CUSTOMER_CODE.test(r.customer_code || '') || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(r.token || '')) { setState('error'); return; }
        // Only Stream's own host, built from the server's customer code and token, ever reaches the frame.
        setSrc(`https://customer-${r.customer_code}.cloudflarestream.com/${r.token}/iframe?preload=true`);
        setState('playing');
      } catch (err) {
        if (!active) return;
        setReason(err?.code === 'locked' ? 'locked' : err?.code === 'not_ready' ? 'not_ready' : err?.code === 'content_not_found' ? 'missing' : err?.status === 503 ? 'closed' : 'error');
        setState('blocked');
      }
    };
    mint();
    timers.current.push(setInterval(mint, RENEW_MS));
    timers.current.push(setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      gatewayFetch('/cinema/play/heartbeat', { method: 'POST', body: JSON.stringify({ content_id: id, seconds: HEARTBEAT_SECONDS }) })
        .then((h) => { if (active && h.reason === 'pass_ceiling') { setReason('pass_ceiling'); setState('blocked'); } })
        .catch(() => { /* a missed heartbeat is not an error the viewer can act on */ });
    }, HEARTBEAT_SECONDS * 1000));
    return () => { active = false; timers.current.forEach(clearInterval); timers.current = []; };
  }, [id, account]);

  const back = <p className="mt-6 text-sm"><Link href={`/social-cinema/title/${id}`} className="underline">Back to the title</Link> · <Link href="/social-cinema" className="underline">Social Cinema</Link></p>;
  const copy = { locked: 'This episode is locked. Unlock it from the title page or get a Cinema Pass.', not_ready: 'This video is still being prepared. Try again in a few minutes.', missing: 'This title is not available.', closed: 'Social Cinema viewing is not open yet.', pass_ceiling: 'Your Cinema Pass has reached its viewing limit for this month. You can still unlock episodes with credits.', error: 'Playback is unavailable right now. Try again in a moment.' };

  return <main id="main" className="mx-auto max-w-[1000px] px-4 py-8 pb-40 sm:px-8 sm:pb-32">
    {state === 'playing' ? <div className="aspect-[9/16] w-full max-w-[420px] overflow-hidden rounded-2xl border border-vx-border bg-black mx-auto sm:aspect-video sm:max-w-none">
      <iframe title="Now playing" src={src} allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture" allowFullScreen className="h-full w-full" />
    </div> : state === 'loading' ? <p role="status" className="text-vx-fg-muted">Preparing playback…</p>
      : state === 'signin' ? <div><p className="mb-4 text-vx-fg-body">Sign in to watch.</p><Button onClick={() => window.dispatchEvent(new CustomEvent('veyrnox:auth-required'))}>Sign in</Button></div>
        : <p role="status">{copy[state === 'blocked' ? reason : state] || copy.error}</p>}
    {back}
  </main>;
}

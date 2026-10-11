'use client';
import { useRef, useState } from 'react';
import { Button } from '../_components/Button';
import { getSession } from '../../lib/authClient';
import { gatewayFetch } from '../_lib/gateway';
import { publicCinemaUrl } from '../../../lib/cinema/publicUrl';
export function CinemaShare({ id, title, episode = false }) {
  const url = publicCinemaUrl(id, episode);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState(''), [manual, setManual] = useState(false);
  const input = useRef(null);
  if (!url) return null;
  function record(kind) {
    if (!getSession()?.user?.id) return;
    void gatewayFetch('/cinema/audience', { method:'POST', body:JSON.stringify({action:'share',content_id:id,kind}), headers:{'idempotency-key':crypto.randomUUID()} }).catch(()=>{});
  }
  async function copy() {
    setBusy(true); setNotice('');
    try {
      await navigator.clipboard.writeText(url);
      record('copy'); setManual(false); setNotice('Public link copied.');
    } catch { setManual(true); setNotice('Copy the public link below.'); }
    finally { setBusy(false); }
  }
  async function share() {
    if (typeof navigator.share !== 'function') { await copy(); return; }
    setBusy(true); setNotice('');
    try {
      await navigator.share({ title: String(title || 'Social Cinema').slice(0, 120), url });
      record('share'); setManual(false); setNotice('Share request completed.');
    } catch (error) {
      if (error?.name === 'AbortError') setNotice('Sharing cancelled.');
      else { setManual(true); setNotice('Sharing is unavailable. Copy the public link below.'); }
    } finally { setBusy(false); }
  }
  return <div className="mt-4" data-testid={`share-${id}`}>
    <div className="flex flex-wrap gap-3">
      <Button variant="ghost" size="sm" onClick={share} disabled={busy} aria-label={`Share ${title}`}>{busy ? 'Preparing…' : 'Share'}</Button>
      <Button variant="ghost" size="sm" onClick={copy} disabled={busy} aria-label={`Copy link to ${title}`}>Copy link</Button>
    </div>
    {notice && <p role="status" className="mt-2 text-sm text-vx-fg-muted">{notice}</p>}
    {manual && <label className="mt-3 block text-sm">Public link
      <input ref={input} aria-label={`Public link to ${title}`} readOnly value={url} onFocus={() => input.current?.select()}
        className="mt-2 w-full rounded-lg border border-vx-border bg-vx-panel p-3" />
    </label>}
  </div>;
}

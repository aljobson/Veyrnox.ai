'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { gatewayFetch } from '../../_lib/gateway';

function key(prefix) {
  return `${prefix}.${globalThis.crypto.randomUUID()}`;
}

function shareToken() {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(32));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return globalThis.btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function messageFor(code, format = 'mp3') {
  const label = format.toUpperCase();
  if (code === 'download_allowance_exhausted') return 'Your audio download allowance is used for this period.';
  if (code === 'format_unavailable') return `This version is not stored as ${label}, so it cannot be downloaded as ${label} without a real transcode.`;
  if (code === 'quote_expired') return 'The allowance quote expired. Review a fresh quote.';
  if (code === 'not_found') return 'This private version or link is no longer available.';
  return 'This action could not be completed. Your existing song and allowance are unchanged.';
}

export function MusicDistributionDialog({ mode, song, onClose }) {
  const dialogRef = useRef(null);
  const closeRef = useRef(null);
  const shareAttempt = useRef(null);
  const exportAttempt = useRef(null);
  const [format, setFormat] = useState('mp3');
  const [links, setLinks] = useState([]);
  const [createdLink, setCreatedLink] = useState(null);
  const [quote, setQuote] = useState(null);
  const [download, setDownload] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    closeRef.current?.focus();
    function handleKeyboard(event) {
      if (event.key === 'Escape') { onClose(); return; }
      if (event.key !== 'Tab') return;
      const focusable = [...(dialogRef.current?.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) || [])];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    }
    document.addEventListener('keydown', handleKeyboard);
    return () => document.removeEventListener('keydown', handleKeyboard);
  }, [onClose]);

  const loadLinks = useCallback(async () => {
    if (mode !== 'share') return;
    try {
      const result = await gatewayFetch(`/music/songs/${song.id}/share-links`);
      setLinks(Array.isArray(result.links) ? result.links : []);
    } catch (reason) {
      setError(messageFor(reason?.code));
    }
  }, [mode, song.id]);

  useEffect(() => {
    const timer = window.setTimeout(loadLinks, 0);
    return () => window.clearTimeout(timer);
  }, [loadLinks]);

  async function createLink() {
    setBusy(true); setError(''); setNotice('');
    const attempt = shareAttempt.current || {
      token: shareToken(), idempotencyKey: key('share'),
    };
    shareAttempt.current = attempt;
    try {
      const result = await gatewayFetch(`/music/songs/${song.id}/share-links`, {
        method: 'POST',
        body: JSON.stringify({
          version_id: song.version_id,
          token: attempt.token,
          idempotency_key: attempt.idempotencyKey,
        }),
      });
      shareAttempt.current = null;
      setCreatedLink(result.link);
      setLinks((current) => [result.link, ...current.filter((item) => item.id !== result.link.id)]);
      setNotice('Private link created. It is not indexed or published.');
    } catch (reason) {
      setError(messageFor(reason?.code, format));
    } finally { setBusy(false); }
  }

  async function copyLink() {
    if (!createdLink?.url) return;
    try {
      await navigator.clipboard.writeText(new URL(createdLink.url, window.location.origin).href);
      setNotice('Private link copied.');
    } catch {
      setError('Copy was blocked. Select the link and copy it manually.');
    }
  }

  async function revokeLink(linkId) {
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await gatewayFetch(`/music/share-links/${linkId}`, {
        method: 'DELETE', body: JSON.stringify({ idempotency_key: key('revoke') }),
      });
      setLinks((current) => current.map((item) => (item.id === linkId ? { ...item, ...result.link } : item)));
      if (createdLink?.id === linkId) setCreatedLink((current) => ({ ...current, ...result.link }));
      setNotice('Private link revoked.');
    } catch (reason) {
      setError(messageFor(reason?.code, format));
    } finally { setBusy(false); }
  }

  async function reviewExport() {
    setBusy(true); setError(''); setNotice(''); setDownload(null);
    try {
      const result = await gatewayFetch(`/music/songs/${song.id}/export-quotes`, {
        method: 'POST', body: JSON.stringify({ version_id: song.version_id, format }),
      });
      if (result.quote?.format !== format) throw Object.assign(new Error('format mismatch'), { code: 'format_unavailable' });
      setQuote(result.quote);
    } catch (reason) {
      setError(messageFor(reason?.code, format));
    } finally { setBusy(false); }
  }

  async function startExport() {
    if (!quote) return;
    setBusy(true); setError(''); setNotice('');
    const attempt = exportAttempt.current?.quoteId === quote.id
      ? exportAttempt.current
      : { quoteId: quote.id, idempotencyKey: key('export') };
    exportAttempt.current = attempt;
    try {
      const started = await gatewayFetch(`/music/songs/${song.id}/exports`, {
        method: 'POST', body: JSON.stringify({
          quote_id: quote.id, idempotency_key: attempt.idempotencyKey,
        }),
      });
      const result = await gatewayFetch(`/music/exports/${started.export.id}`);
      if (result.export?.format !== format) throw Object.assign(new Error('format mismatch'), { code: 'format_unavailable' });
      exportAttempt.current = null;
      setDownload(result.export);
      setNotice(`${format.toUpperCase()} ready. ${started.allowance.remaining} download${started.allowance.remaining === 1 ? '' : 's'} remain in this allowance period.`);
    } catch (reason) {
      if (reason?.code === 'quote_expired') { setQuote(null); exportAttempt.current = null; }
      setError(messageFor(reason?.code, format));
    } finally { setBusy(false); }
  }

  const activeLinks = links.filter((item) => !item.revoked_at);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="music-distribution-title" className="w-full max-w-lg rounded-2xl border border-vx-border bg-vx-panel p-6 shadow-2xl sm:p-8">
        <div className="flex items-start gap-4">
          <div className="min-w-0 flex-1">
            <p className="font-vx-mono text-xs font-bold uppercase tracking-widest text-vx-accent">{mode === 'share' ? 'Link-only sharing' : 'Owned audio download'}</p>
            <h2 id="music-distribution-title" className="mt-2 break-words font-vx text-2xl font-black">{mode === 'share' ? `Share “${song.title}” privately` : `Download “${song.title}”`}</h2>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Close" className="grid min-h-11 min-w-11 place-items-center rounded-full border border-vx-border font-bold hover:border-vx-border-boost focus:outline-none focus-visible:ring-2 focus-visible:ring-vx-accent">×</button>
        </div>

        {mode === 'share' ? (
          <div className="mt-6">
            <p className="text-sm leading-6 text-vx-fg-muted">Anyone holding a link can listen to this immutable version. It is not indexed or published, and the link can be revoked.</p>
            {createdLink?.url && !createdLink.revoked_at ? (
              <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                <input readOnly aria-label="Private share link" value={new URL(createdLink.url, globalThis.location?.origin || 'https://veyrnox.ai').href} className="min-h-11 min-w-0 flex-1 rounded-xl border border-vx-border bg-vx-base px-3 text-sm text-vx-fg" />
                <button type="button" onClick={copyLink} className="min-h-11 rounded-xl bg-vx-accent px-4 font-bold text-vx-accent-ink">Copy link</button>
              </div>
            ) : (
              <button type="button" disabled={busy} onClick={createLink} className="mt-5 min-h-11 rounded-full bg-vx-accent px-5 font-bold text-vx-accent-ink disabled:opacity-50">{busy ? 'Creating…' : 'Create private link'}</button>
            )}
            {activeLinks.length ? <div className="mt-6"><h3 className="font-vx text-lg font-black">Active links</h3><ul className="mt-3 space-y-2">{activeLinks.map((link) => <li key={link.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-vx-border bg-vx-base p-3 text-sm"><span>Created {new Date(link.created_at).toLocaleDateString()}</span><button type="button" disabled={busy} onClick={() => revokeLink(link.id)} className="min-h-11 rounded-full border border-vx-danger/50 px-4 font-bold text-vx-danger disabled:opacity-50">Revoke</button></li>)}</ul></div> : null}
          </div>
        ) : (
          <div className="mt-6">
            <p className="text-sm leading-6 text-vx-fg-muted">Choose the format already stored for this immutable version. Veyrnox.ai does not relabel or transcode the source. Review the exact allowance impact before claiming the download.</p>
            <label className="mt-5 block text-sm font-bold text-vx-fg" htmlFor="music-download-format">Stored audio format</label>
            <select
              id="music-download-format"
              value={format}
              disabled={busy}
              onChange={(event) => {
                setFormat(event.target.value);
                setQuote(null); setDownload(null); setError(''); setNotice('');
                exportAttempt.current = null;
              }}
              className="mt-2 min-h-11 w-full rounded-xl border border-vx-border bg-vx-base px-3 text-vx-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-vx-accent disabled:opacity-50"
            >
              <option value="mp3">MP3</option>
              <option value="wav">WAV</option>
              <option value="flac">FLAC</option>
            </select>
            {!quote ? <button type="button" disabled={busy} onClick={reviewExport} className="mt-5 min-h-11 rounded-full bg-vx-accent px-5 font-bold text-vx-accent-ink disabled:opacity-50">{busy ? 'Checking…' : `Review ${format.toUpperCase()} allowance`}</button> : (
              <div className="mt-5 rounded-2xl border border-vx-border bg-vx-base p-4">
                <dl className="grid grid-cols-2 gap-4 text-sm"><div><dt className="text-vx-fg-muted">This version</dt><dd className="mt-1 font-bold text-vx-fg">{quote.consumes_allowance ? 'Uses 1 download' : 'Already claimed · uses 0'}</dd></div><div><dt className="text-vx-fg-muted">After export</dt><dd className="mt-1 font-bold text-vx-money">{quote.remaining_after} remaining</dd></div></dl>
                {!download ? <button type="button" disabled={busy} onClick={startExport} className="mt-5 min-h-11 w-full rounded-full bg-vx-accent px-5 font-bold text-vx-accent-ink disabled:opacity-50">{busy ? 'Preparing…' : `Prepare ${format.toUpperCase()} download`}</button> : <a href={download.url} className="mt-5 inline-flex min-h-11 w-full items-center justify-center rounded-full bg-vx-accent px-5 font-bold text-vx-accent-ink">Download {format.toUpperCase()} now</a>}
              </div>
            )}
          </div>
        )}

        {error ? <p role="alert" className="mt-4 rounded-xl border border-vx-danger/40 bg-vx-danger/10 p-3 text-sm text-vx-danger">{error}</p> : null}
        {notice ? <p role="status" className="mt-4 rounded-xl border border-vx-accent/30 bg-vx-accent/10 p-3 text-sm text-vx-fg-body">{notice}</p> : null}
      </section>
    </div>
  );
}

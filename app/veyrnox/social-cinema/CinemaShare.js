'use client';
import { useI18n } from '../../../components/I18nProvider.jsx';
import { useRef, useState } from 'react';
import { Button } from '../_components/Button';
import { getSession } from '../../lib/authClient';
import { gatewayFetch } from '../_lib/gateway';
import { publicCinemaUrl } from '../../../lib/cinema/publicUrl';
export function CinemaShare({ id, title, episode = false }) {
  const { t, href } = useI18n();
  const canonical = publicCinemaUrl(id, episode);
  const url = canonical ? new URL(href(new URL(canonical).pathname), canonical).href : null;
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
      record('copy'); setManual(false); setNotice(t("cinema.share.publicLinkCopied"));
    } catch { setManual(true); setNotice(t("cinema.share.copyThePublicLinkBelow")); }
    finally { setBusy(false); }
  }
  async function share() {
    if (typeof navigator.share !== 'function') { await copy(); return; }
    setBusy(true); setNotice('');
    try {
      await navigator.share({ title: String(title || t("label.Social Cinema")).slice(0, 120), url });
      record('share'); setManual(false); setNotice(t("cinema.share.shareRequestCompleted"));
    } catch (error) {
      if (error?.name === 'AbortError') setNotice(t("cinema.share.sharingCancelled"));
      else { setManual(true); setNotice(t("cinema.share.sharingIsUnavailableCopyThePublic")); }
    } finally { setBusy(false); }
  }
  return <div className="mt-4" data-testid={`share-${id}`}>
    <div className="flex flex-wrap gap-3">
      <Button variant="ghost" size="sm" onClick={share} disabled={busy} aria-label={t('cinema.share.title', { title })}>{busy ? t("cinema.share.preparing") : t("cinema.share.share")}</Button>
      <Button variant="ghost" size="sm" onClick={copy} disabled={busy} aria-label={t('cinema.share.copyTitle', { title })}>{t("cinema.share.copyLink")}</Button>
    </div>
    {notice && <p role="status" className="mt-2 text-sm text-vx-fg-muted">{notice}</p>}
    {manual && <label className="mt-3 block text-sm">{t("cinema.share.publicLink")}<input ref={input} aria-label={t('cinema.share.publicTitle', { title })} readOnly value={url} onFocus={() => input.current?.select()}
        className="mt-2 w-full rounded-lg border border-vx-border bg-vx-panel p-3" />
    </label>}
  </div>;
}

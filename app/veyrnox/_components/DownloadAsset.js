'use client';
import { tOr } from '../../../lib/i18n/translate.mjs';
import { useI18n } from '../../../components/I18nProvider';

import { useRef, useState } from 'react';
import { gatewayFetch } from '../_lib/gateway';
import { AUDIO_STEMS,isDemucsModel } from '../../../lib/audioStems.mjs';
import { getSession } from '../../lib/authClient';

/**
 * Download on a Library card. The link a card shows its file with only displays it, so this asks for a fresh one
 * that tells the browser to save the file, then follows it. The page stays where it is while the file saves.
 */
export function DownloadAsset({ row }) {
  const { t } = useI18n();
  const [stem,setStem]=useState('vocals');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const busyRef = useRef(false); // synchronous: a second click must not ask for a second link
  if (row?.state !== 'succeeded' || row.has_asset === false || !row.asset_url) return null;

  const download = async () => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError(null);
    try {
      const owner=getSession()?.user?.id; if(!owner)throw new Error(t("app.library.download.signIn"));
      const asset = isDemucsModel(row.model_id)
        ? await gatewayFetch(`/jobs/${encodeURIComponent(row.job_id)}/asset?stem=${stem}&download=1`)
        : await gatewayFetch(`/jobs/${encodeURIComponent(row.job_id)}/asset?download=1`);
      if(getSession()?.user?.id!==owner)return;
      if (typeof asset?.url !== 'string' || !asset.url.startsWith('https://')) throw new Error(t("app.library.download.invalid"));
      // Same tab: a click that waited for the link is no longer a user gesture, and a new tab would be blocked.
      window.location.assign(asset.url);
    } catch (e) {
      setError(tOr(t, `app.library.assetError.${e?.status}`, t('app.library.assetError.default')));
    } finally {
      busyRef.current = false; setBusy(false);
    }
  };

  return (
    <>
      {isDemucsModel(row.model_id)&&<label className="mx-4 mb-2 block text-xs">{t("app.library.download.stem")}<select aria-label={t("app.library.download.label")} value={stem} onChange={e=>setStem(e.target.value)} disabled={busy} className="ms-2 rounded border border-vx-border bg-vx-base">{AUDIO_STEMS.map(name=><option key={name} value={name}>{tOr(t, `app.editor.stem.${name}`, name)}</option>)}</select></label>}
      <button type="button" data-testid="library-download" onClick={download} disabled={busy}
        className="mx-4 mb-3 inline-block text-xs font-semibold text-vx-accent hover:underline disabled:opacity-60">
        {busy ? t("app.library.download.preparing") : t("label.Download")}
      </button>
      {error && <p role="alert" data-testid="library-download-error" className="px-4 pb-3 text-xs text-vx-danger">{error}</p>}
    </>
  );
}

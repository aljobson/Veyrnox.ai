'use client';
import { useRef, useState } from 'react';
import { gatewayFetch } from '../_lib/gateway';
import { AUDIO_STEMS,isDemucsModel } from '../../../lib/audioStems.mjs';
import { getSession } from '../../lib/authClient';
import { assetErrorMessage } from '../_lib/assetRefresh';

/**
 * Download on a Library card. The link a card shows its file with only displays it, so this asks for a fresh one
 * that tells the browser to save the file, then follows it. The page stays where it is while the file saves.
 */
export function DownloadAsset({ row }) {
  const [stem,setStem]=useState('vocals');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const busyRef = useRef(false); // synchronous: a second click must not ask for a second link
  if (row?.state !== 'succeeded' || row.has_asset === false || !row.asset_url) return null;

  const download = async () => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError(null);
    try {
      const owner=getSession()?.user?.id; if(!owner)throw new Error('Sign in again to download.');
      const asset = isDemucsModel(row.model_id)
        ? await gatewayFetch(`/jobs/${encodeURIComponent(row.job_id)}/asset?stem=${stem}&download=1`)
        : await gatewayFetch(`/jobs/${encodeURIComponent(row.job_id)}/asset?download=1`);
      if(getSession()?.user?.id!==owner)return;
      if (typeof asset?.url !== 'string' || !asset.url.startsWith('https://')) throw new Error('invalid asset response');
      // Same tab: a click that waited for the link is no longer a user gesture, and a new tab would be blocked.
      window.location.assign(asset.url);
    } catch (e) {
      setError(assetErrorMessage(e));
    } finally {
      busyRef.current = false; setBusy(false);
    }
  };

  return (
    <>
      {isDemucsModel(row.model_id)&&<label className="mx-4 mb-2 block text-xs">Audio stem<select aria-label="Library audio stem" value={stem} onChange={e=>setStem(e.target.value)} disabled={busy} className="ml-2 rounded border border-vx-border bg-vx-base">{AUDIO_STEMS.map(name=><option key={name}>{name}</option>)}</select></label>}
      <button type="button" onClick={download} disabled={busy}
        className="mx-4 mb-3 inline-block text-xs font-semibold text-vx-accent hover:underline disabled:opacity-60">
        {busy ? 'Preparing download' : 'Download'}
      </button>
      {error && <p role="alert" className="px-4 pb-3 text-xs text-vx-danger">{error}</p>}
    </>
  );
}

'use client';

import { useState } from 'react';
import { gatewayFetch } from '../_lib/gateway';
import { buildProvenanceDownload } from '../_lib/provenanceDownload';

export function DownloadProvenance({ row, className = 'text-xs font-semibold text-vx-accent hover:underline disabled:opacity-60', errorClassName = 'text-xs text-vx-danger' }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (row?.state !== 'succeeded' || !row?.job_id) return null;

  async function download() {
    setBusy(true);
    setError('');
    try {
      const record = await gatewayFetch(`/jobs/${encodeURIComponent(row.job_id)}/provenance`);
      const file = buildProvenanceDownload(record);
      const url = URL.createObjectURL(new Blob([file.text], { type: file.mimeType }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = file.filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError('The provenance record is unavailable right now. Your generated file is unchanged.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" onClick={download} disabled={busy} className={className}>
        {busy ? 'Preparing record…' : 'Provenance JSON'}
      </button>
      {error && <p role="alert" className={errorClassName}>{error}</p>}
    </>
  );
}

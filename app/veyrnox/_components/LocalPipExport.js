'use client';

import { useEffect, useRef, useState } from 'react';
import { gatewayFetch } from '../_lib/gateway';
import { exportLocalPictureInPicture, localPipSupport } from '../_lib/localPipExport';

const errorCopy = {
  browser_unsupported: 'This browser cannot record a local picture-in-picture export. Use current Chrome, Edge or Firefox.',
  format_unsupported: 'This browser cannot create the WebM export format.',
  source_timeout: 'One of the videos took too long to prepare. Try the export again.',
  source_unreadable: 'One of the videos could not be decoded by this browser.',
  duration_unsupported: 'The generated performance has an unsupported duration.',
  recording_failed: 'The browser could not finish the local export.',
};

export function LocalPipExport({ jobId, background, settings }) {
  const [state, setState] = useState('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [resultUrl, setResultUrl] = useState('');
  const busy = useRef(false);

  useEffect(() => () => { if (resultUrl) URL.revokeObjectURL(resultUrl); }, [resultUrl]);

  async function compose() {
    if (busy.current || !jobId || !background?.file) return;
    const support = localPipSupport();
    if (!support.ok) { setError(errorCopy[support.code]); return; }
    busy.current = true;
    setState('exporting');
    setProgress(0);
    setError('');
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    setResultUrl('');
    try {
      const asset = await gatewayFetch(`/jobs/${encodeURIComponent(jobId)}/asset`);
      if (typeof asset?.url !== 'string' || !asset.url.startsWith('https://')) throw new Error('source_unreadable');
      const response = await fetch(asset.url);
      if (!response.ok) throw new Error('source_unreadable');
      const performanceBlob = await response.blob();
      const result = await exportLocalPictureInPicture({
        performanceBlob,
        backgroundFile: background.file,
        settings,
        onProgress: setProgress,
      });
      setResultUrl(URL.createObjectURL(result));
      setState('ready');
    } catch (next) {
      const code = next instanceof Error ? next.message : 'recording_failed';
      setError(errorCopy[code] || errorCopy.recording_failed);
      setState('failed');
    } finally {
      busy.current = false;
    }
  }

  return (
    <div className="basis-full rounded-xl border border-vx-accent/35 bg-vx-accent/[0.06] p-4" aria-label="Local picture-in-picture export">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-vx-mono text-[9px] font-bold uppercase tracking-[0.12em] text-vx-accent">Local finishing step</p>
          <p className="mt-1 text-sm font-black">Compose picture-in-picture</p>
          <p className="mt-1 max-w-xl text-[11px] leading-5 text-vx-fg-muted">Combines the completed performance with your background in this browser. The WebM download is not uploaded, added to Library or charged again.</p>
        </div>
        <button type="button" disabled={state === 'exporting'} onClick={compose} className="inline-flex min-h-10 items-center rounded-full bg-vx-accent px-4 text-xs font-extrabold text-vx-accent-ink disabled:opacity-50">
          {state === 'exporting' ? `Composing ${Math.round(progress * 100)}%` : resultUrl ? 'Compose again' : 'Compose locally'}
        </button>
      </div>
      {state === 'exporting' && <progress className="mt-3 w-full accent-vx-accent" value={progress} max="1">{Math.round(progress * 100)}%</progress>}
      {error && <p role="alert" className="mt-3 text-xs text-vx-danger">{error}</p>}
      {resultUrl && <a href={resultUrl} download="veyrnox-picture-in-picture.webm" className="mt-3 inline-flex min-h-10 items-center rounded-full border border-vx-border px-4 text-xs font-extrabold text-vx-fg hover:border-vx-accent">Download picture-in-picture WebM</a>}
    </div>
  );
}

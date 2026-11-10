'use client';

import { useState } from 'react';
import { buildPerformanceProjectDownload } from '../_lib/performanceProjectManifest';

export function DownloadPerformanceProject({ project, className = '' }) {
  const [status, setStatus] = useState('');

  function download() {
    try {
      const file = buildPerformanceProjectDownload(project);
      const url = URL.createObjectURL(new Blob([file.text], { type: file.mimeType }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = file.filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setStatus('Project JSON downloaded. Reconfirm rights and price before reuse.');
    } catch {
      setStatus('This project could not be exported. Your media and settings are unchanged.');
    }
  }

  return (
    <>
      <button type="button" onClick={download} className={className}>Export project JSON</button>
      {status && <p role="status" className="basis-full text-[11px] leading-4 text-vx-fg-muted">{status}</p>}
    </>
  );
}

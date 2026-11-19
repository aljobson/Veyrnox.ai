'use client';
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../../../../components/I18nProvider';
import { Button } from '../Button';
import { exportProInterchange } from '../../_lib/proInterchangeExport.mjs';
import { importProInterchange } from '../../_lib/proInterchangeImport.mjs';

const MAX_FILE_BYTES = 16 * 1024 * 1024;
const FILE_NAME = 'veyrnox-sequence.fcproj';

/** Flagged (proEditor) FilmCraft project export and import. Converts locally; nothing is uploaded. onLoadTimeline owns the undo boundary and relinking. */
export function ProInterchangeControls({ tl, onLoadTimeline, disabled = false, openDisabled = false }) {
  const { t } = useI18n();
  const chooser = useRef(null), alive = useRef(true), manifest = useRef(null), running = useRef(false), urls = useRef(new Map());
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [status, setStatus] = useState('');
  useEffect(() => {
    alive.current = true;
    const pending = urls.current;
    return () => { alive.current = false; for (const [url, timer] of pending) { clearTimeout(timer); URL.revokeObjectURL(url); } pending.clear(); };
  }, []);
  function download() {
    if (disabled || running.current) return;
    setError(''); setStatus('');
    const result = exportProInterchange(tl, manifest.current ? { manifest: manifest.current } : {});
    if (!result.ok) { setError(t('app.editor.proInterchange.failed')); return; }
    manifest.current = result.manifest;
    const url = URL.createObjectURL(new Blob([result.bytes], { type: 'application/octet-stream' }));
    urls.current.set(url, setTimeout(() => { URL.revokeObjectURL(url); urls.current.delete(url); }, 1000));
    const link = document.createElement('a'); link.href = url; link.download = FILE_NAME; document.body.appendChild(link); link.click(); link.remove();
    setStatus(t('app.editor.proInterchange.exported', { count: result.report.length }));
  }
  async function open(event) {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file || disabled || running.current || !onLoadTimeline) return;
    running.current = true; setBusy(true); setError(''); setStatus('');
    try {
      if (file.size > MAX_FILE_BYTES) throw new Error('too_large');
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (!alive.current) return;
      const result = importProInterchange(bytes, manifest.current ? { manifest: manifest.current } : {});
      if (!result.ok) throw new Error(result.error.code);
      if (onLoadTimeline(result.draft) === false) throw new Error('load_failed');
      manifest.current = result.manifest;
      setStatus(t('app.editor.proInterchange.imported', { count: result.report.length }));
    } catch { if (alive.current) setError(t('app.editor.proInterchange.failed')); }
    finally { running.current = false; if (alive.current) setBusy(false); }
  }
  return <section data-testid="pro-interchange" aria-label={t('app.editor.proInterchange.title')} className="space-y-2">
    <h3 className="text-sm font-bold">{t('app.editor.proInterchange.title')}</h3>
    <div className="flex flex-wrap gap-2">
      <Button type="button" size="sm" variant="ghost" disabled={disabled || busy} data-testid="pro-interchange-export" onClick={download}>{t('app.editor.proInterchange.export')}</Button>
      <Button type="button" size="sm" variant="ghost" disabled={disabled || openDisabled || busy || !onLoadTimeline} data-testid="pro-interchange-import" onClick={() => chooser.current?.click()}>{t('app.editor.proInterchange.import')}</Button>
      <input data-testid="pro-interchange-input" ref={chooser} aria-label={t('app.editor.proInterchange.choose')} type="file" accept=".fcproj" className="sr-only" tabIndex={-1} disabled={disabled || openDisabled || busy} onChange={open} />
    </div>
    <p className="text-[10px] text-vx-fg-muted">{t('app.editor.proInterchange.help')}</p>
    {openDisabled && <p className="text-[10px] text-vx-fg-muted">{t('app.editor.proInterchange.detach')}</p>}
    {busy && <p role="status" className="text-xs">{t('app.editor.proInterchange.busy')}</p>}
    {error && <p role="alert" className="text-xs">{error}</p>}
    {status && <p data-testid="pro-interchange-status" role="status" className="text-xs">{status}</p>}
  </section>;
}

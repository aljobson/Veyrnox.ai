'use client';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useI18n } from '../../../components/I18nProvider';
import { helperCopy } from '../../../lib/i18n/helperCopy.mjs';
import { attachAccept, attachSlotFor } from '../../../lib/createAttach.mjs';
import { gatewayFetch } from '../_lib/gateway';
import { getStoredUserId, onSessionChange } from '../../lib/authClient';
import { jobsPagePath } from '../../../lib/jobListCursor';
import { listDeviceLibrary, loadDeviceLibrary, saveDeviceLibrary } from '../_lib/deviceLibrary.mjs';
import { probeMedia } from '../_lib/editorMedia.mjs';
import { Modal } from './Modal';

// "Add files" for Create and for a template: pick several references at once from
// what the account generated (job ids, checked server side as "From library" is)
// or from files kept on this device (the Device Library, IndexedDB only). New
// files dropped here are saved to the Device Library when it can hold them.
// Nothing is uploaded until the user generates.

const KINDS = ['image', 'video', 'audio'];
const CHIP_CLASS = 'inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-bold';
const CHIP_ON = 'bg-vx-fg text-vx-base', CHIP_OFF = 'text-vx-fg-body hover:bg-vx-fg/10';
const LABEL = { image: 'app.create.addFiles.images', video: 'app.create.addFiles.videos', audio: 'app.create.addFiles.audios' };
const SHOWN = 12; // each generated preview costs one asset-link request (120 a minute)
const guest = () => 'guest';
const actorNow = () => getStoredUserId() || 'guest';
// Generated files keep their real type; a device file's kind comes from its probe.
const generatedKind = mime => attachSlotFor({ type: mime });

const ICONS = {
  all: <path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8L12 3Zm6 11 .9 2.1 2.1.9-2.1.9L18 21l-.9-2.1-2.1-.9 2.1-.9L18 14Z" />,
  image: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 16 5-5 4 4 3-3 6 6" /><circle cx="15.5" cy="9" r="1.5" /></>,
  video: <><rect x="3" y="7" width="12" height="10" rx="2" /><path d="m15 11 6-3v8l-6-3" /></>,
  audio: <><path d="M9 18V6l10-2v12" /><circle cx="6.5" cy="18" r="2.5" /><circle cx="16.5" cy="16" r="2.5" /></>,
};
const Glyph = ({ name, className = 'h-5 w-5' }) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>{ICONS[name]}</svg>;

/**
 * @typedef {{ file: File } | { asset: { id: string, url: string, label: string, mimeType: string } }} AddedFile
 * @param {object} props
 * @param {{image:number, video:number, audio:number}} props.capacity  most of each kind the current model takes
 * @param {(files: AddedFile[]) => void} props.onAdd  the picks, in the order chosen
 * @param {() => void} props.onClose
 */
export function AddFilesDialog({ capacity, onAdd, onClose }) {
  const actor = useSyncExternalStore(onSessionChange, actorNow, guest);
  return <AddFiles key={actor} actor={actor} capacity={capacity} onAdd={onAdd} onClose={onClose} />;
}

function AddFiles({ actor, capacity, onAdd, onClose }) {
  const { t, locale } = useI18n();
  const [tab, setTab] = useState('generated');
  const [filter, setFilter] = useState('all');
  const [picked, setPicked] = useState([]); // keys, in the order chosen
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const generated = useGenerated(actor !== 'guest');
  const device = useDeviceFiles(actor);
  const kinds = KINDS.filter(kind => capacity[kind] > 0);

  const items = tab === 'generated' ? generated.items : device.items;
  const byKey = useMemo(() => new Map([...generated.items, ...device.items].map(item => [item.key, item])), [generated.items, device.items]);
  const chosen = picked.map(key => byKey.get(key)).filter(Boolean);
  const count = kind => chosen.filter(item => item.kind === kind).length;
  const shown = items.filter(item => kinds.includes(item.kind) && (filter === 'all' || item.kind === filter));

  function toggle(item) {
    setPicked(previous => previous.includes(item.key) ? previous.filter(key => key !== item.key)
      : count(item.kind) < capacity[item.kind] ? [...previous, item.key] : previous);
  }

  async function addFromDevice(fileList) {
    const files = [...(fileList || [])];
    if (!files.length) return;
    setBusy(true); setProblem(''); setTab('uploaded');
    const keys = await device.add(files, key => setProblem(t(key)));
    setBusy(false);
    // New files are picked for the user while the model still has room for them.
    setPicked(previous => {
      const next = [...previous];
      for (const { key, kind } of keys) {
        const used = next.map(k => byKey.get(k) || keys.find(row => row.key === k)).filter(row => row?.kind === kind).length;
        if (!next.includes(key) && used < capacity[kind]) next.push(key);
      }
      return next;
    });
  }

  async function finish() {
    setBusy(true); setProblem('');
    try {
      const files = [];
      for (const item of chosen) {
        if (item.asset) files.push({ asset: item.asset });
        else if (item.file) files.push({ file: item.file });
        else {
          const { blob, label } = await loadDeviceLibrary(actor, item.deviceId);
          files.push({ file: new File([blob], label, { type: blob.type }) });
        }
      }
      onAdd(files);
    } catch (error) {
      setProblem(helperCopy(t, locale, error.message));
      setBusy(false);
    }
  }

  const chip = active => `${CHIP_CLASS} ${active ? CHIP_ON : CHIP_OFF}`;
  const loading = tab === 'generated' ? generated.loading : device.loading;
  const failed = tab === 'generated' && generated.error;

  return (
    <Modal onCancel={onClose} aria-labelledby="add-files-title" className="items-center justify-center p-4">
      <div data-testid="add-files-dialog" className={`flex max-h-[90dvh] w-full max-w-[720px] flex-col overflow-hidden rounded-2xl border bg-vx-panel ${dragging ? 'border-vx-accent' : 'border-vx-border'}`}
        onDragOver={event => { event.preventDefault(); setDragging(true); }}
        onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false); }}
        onDrop={event => { event.preventDefault(); setDragging(false); addFromDevice(event.dataTransfer.files); }}>
        <div className="px-5 pt-5 sm:px-7">
          <div className="flex items-start justify-between gap-4">
            <h2 id="add-files-title" className="text-3xl font-extrabold text-vx-fg">{t('app.create.addFiles.title')}</h2>
            <button type="button" onClick={onClose} aria-label={t('authGate.close')} className="p-1 text-vx-fg-muted hover:text-vx-fg">
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
            </button>
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-vx-fg-body">{t('app.create.addFiles.dropHint')}</p>
            <label className={`flex min-h-11 w-full cursor-pointer items-center justify-center rounded-xl border border-vx-fg-body px-4 text-base font-bold text-vx-fg hover:bg-vx-fg/10 has-disabled:opacity-50 has-focus-visible:outline-solid has-focus-visible:outline-2 has-focus-visible:outline-vx-accent sm:w-1/2`}>
              {t('app.create.addFiles.upload')}
              <input data-testid="create-attach" type="file" multiple accept={attachAccept()} disabled={busy} className="sr-only"
                onChange={event => { const files = event.target.files; addFromDevice(files); event.target.value = ''; }} />
            </label>
          </div>
          <div role="tablist" className="mt-6 flex">
            <button type="button" role="tab" aria-selected={tab === 'generated'} onClick={() => setTab('generated')}
              className={`flex-1 border-b-2 pb-3 text-sm font-bold ${tab === 'generated' ? 'border-vx-accent text-vx-accent' : 'border-vx-border text-vx-fg-muted hover:text-vx-fg'}`}>{t('app.create.addFiles.generated')}</button>
            <button type="button" role="tab" aria-selected={tab === 'uploaded'} onClick={() => setTab('uploaded')}
              className={`flex-1 border-b-2 pb-3 text-sm font-bold ${tab === 'uploaded' ? 'border-vx-accent text-vx-accent' : 'border-vx-border text-vx-fg-muted hover:text-vx-fg'}`}>{t('app.create.addFiles.uploaded')}</button>
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            <button type="button" aria-pressed={filter === 'all'} onClick={() => setFilter('all')} className={chip(filter === 'all')}><Glyph name="all" />{t('app.create.addFiles.all')}</button>
            {kinds.map(kind => <button key={kind} type="button" aria-pressed={filter === kind} onClick={() => setFilter(kind)} className={chip(filter === kind)}>
              <Glyph name={kind} />{t(LABEL[kind])}<span className="font-vx-mono vx-num">{t('app.create.addFiles.count', { selected: count(kind), max: capacity[kind] })}</span>
            </button>)}
          </div>
        </div>
        <div className="min-h-[280px] flex-1 overflow-y-auto px-5 py-5 sm:px-7">
          {busy && <p role="status" className="mb-3 text-sm text-vx-fg-muted">{t('app.create.addFiles.working')}</p>}
          {problem && <p role="alert" className="mb-3 text-sm text-vx-danger">{problem}</p>}
          {failed && <p role="alert" className="text-sm text-vx-danger">{t('app.create.addFiles.error')}</p>}
          {!failed && !shown.length && (loading ? <p role="status" className="py-16 text-center text-sm text-vx-fg-muted">{t('app.create.addFiles.loading')}</p> : (
            <div className="flex flex-col items-center gap-4 py-16 text-vx-fg-muted">
              <Glyph name="all" className="h-20 w-20" />
              <p className="text-base">{t(tab === 'generated' ? 'app.create.addFiles.emptyGenerated' : 'app.create.addFiles.emptyUploaded')}</p>
            </div>
          ))}
          {shown.length > 0 && <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {shown.map(item => {
              const order = picked.indexOf(item.key);
              const full = order < 0 && count(item.kind) >= capacity[item.kind];
              return <li key={item.key}>
                <button type="button" aria-pressed={order >= 0} disabled={full || busy} onClick={() => toggle(item)} title={item.label}
                  aria-label={t('app.create.addFiles.select', { name: item.label })}
                  className={`relative block aspect-square w-full overflow-hidden rounded-lg border-2 bg-vx-base disabled:opacity-40 ${order >= 0 ? 'border-vx-accent' : 'border-vx-border hover:border-vx-fg-muted'}`}>
                  {item.previewUrl && item.kind === 'image' && <img src={item.previewUrl} alt="" className="h-full w-full object-cover" />}
                  {item.previewUrl && item.kind === 'video' && <video src={item.previewUrl} muted playsInline preload="metadata" className="h-full w-full object-cover" />}
                  {(!item.previewUrl || item.kind === 'audio') && <span className="flex h-full flex-col items-center justify-center gap-2 p-2 text-vx-fg-muted"><Glyph name={item.kind} className="h-7 w-7" /><span className="line-clamp-2 break-all text-[11px]">{item.label}</span></span>}
                  {order >= 0 && <span className="absolute end-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-vx-accent font-vx-mono text-xs font-bold text-vx-base">{order + 1}</span>}
                </button>
              </li>;
            })}
          </ul>}
          {tab === 'generated' && (generated.hasMore || failed) && <button type="button" disabled={loading} onClick={generated.more}
            className="mt-4 rounded-full border border-vx-border px-4 py-2 text-sm font-bold text-vx-fg hover:border-vx-accent disabled:opacity-50">
            {loading ? t('app.create.addFiles.loading') : t('app.create.addFiles.older')}
          </button>}
        </div>
        <div className="flex items-center justify-between gap-3 bg-vx-base/60 px-5 py-4 sm:px-7">
          <button type="button" onClick={onClose} className="min-h-11 rounded-xl bg-vx-fg/10 px-6 text-base font-bold text-vx-fg hover:bg-vx-fg/15">{t('app.create.addFiles.cancel')}</button>
          <button type="button" data-testid="add-files-confirm" disabled={!chosen.length || busy} onClick={finish}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-vx-accent px-6 text-base font-bold text-vx-base disabled:bg-vx-fg/15 disabled:text-vx-fg-muted">
            {t('app.create.addFiles.add')}
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m5 12 5 5 9-10" /></svg>
          </button>
        </div>
      </div>
    </Modal>
  );
}

// Recent finished generations of the caller, the types a model can take, a page at a time.
function useGenerated(signedIn) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const loadRef = useRef(null);
  useEffect(() => {
    if (!signedIn) return undefined;
    let cancelled = false, busy = false, started = false, cursor = null;
    const queue = [];
    const load = async () => {
      if (busy || cancelled) return;
      busy = true; setLoading(true); setError(false);
      try {
        if (!started || (!queue.length && cursor)) {
          const page = await gatewayFetch(started ? jobsPagePath(cursor, 48) : '/jobs?limit=48');
          if (cancelled) return;
          if (!Array.isArray(page.jobs)) throw new Error('invalid_page');
          queue.push(...page.jobs.filter(job => job.state === 'succeeded' && job.has_asset && !job.held));
          cursor = page.next || null; started = true;
        }
        const found = [];
        let checked = 0;
        while (queue.length && found.length < SHOWN && checked++ < SHOWN * 2 && !cancelled) {
          const job = queue.shift();
          try {
            const asset = await gatewayFetch(`/jobs/${job.job_id}/asset`);
            const mimeType = String(asset.mime_type), kind = generatedKind(mimeType);
            if (kind) found.push({ key: `g-${job.job_id}`, kind, label: job.label || job.job_id, previewUrl: asset.url, asset: { id: job.job_id, url: asset.url, label: job.label || '', mimeType } });
          } catch { /* expired or unreadable: leave it out */ }
        }
        if (!cancelled) { setItems(previous => [...previous, ...found.filter(item => !previous.some(old => old.key === item.key))]); setHasMore(queue.length > 0 || !!cursor); }
      } catch {
        if (!cancelled) setError(true);
      } finally {
        busy = false;
        if (!cancelled) setLoading(false);
      }
    };
    loadRef.current = load; load();
    return () => { cancelled = true; loadRef.current = null; };
  }, [signedIn]);
  return { items, loading, error, hasMore, more: () => loadRef.current?.() };
}

// Files kept on this device for this account, plus any added now that it could not keep.
function useDeviceFiles(actor) {
  const [rows, setRows] = useState([]);
  const [loose, setLoose] = useState([]);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [previews, setPreviews] = useState({}); // object URLs for files added in this dialog
  const urls = useRef([]);
  useEffect(() => {
    let active = true;
    listDeviceLibrary(actor).then(list => { if (active) setRows(list); }).catch(() => { if (active) setRows([]); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [actor, revision]);
  useEffect(() => { const live = urls.current; return () => { for (const url of live) URL.revokeObjectURL(url); }; }, []);
  const preview = (key, file) => { const url = URL.createObjectURL(file); urls.current.push(url); setPreviews(previous => ({ ...previous, [key]: url })); return url; };

  const items = [
    ...loose,
    ...rows.filter(row => KINDS.includes(row.kind)).map(row => ({ key: `d-${row.id}`, kind: row.kind, label: row.label, deviceId: row.id, previewUrl: previews[`d-${row.id}`] || null })),
  ];

  /** Saves each file on this device when it can; returns the new rows' keys and kinds. */
  async function add(files, report) {
    const added = [];
    for (const file of files) {
      const kind = attachSlotFor(file) || ['image', 'video', 'audio'].find(prefix => String(file.type).startsWith(`${prefix}/`));
      if (!kind) { report('app.create.attach.unsupported'); continue; }
      try {
        const row = await saveDeviceLibrary(actor, file, await probeMedia(file), { isCurrent: () => actor === actorNow() });
        preview(`d-${row.id}`, file);
        added.push({ key: `d-${row.id}`, kind });
      } catch {
        // HEIC and other types the browser cannot play, or a full device store: use it now, keep it for this visit only.
        const key = `s-${crypto.randomUUID()}`;
        setLoose(previous => [{ key, kind, label: file.name, file, previewUrl: preview(key, file) }, ...previous]);
        added.push({ key, kind, file, label: file.name });
      }
    }
    setRevision(n => n + 1);
    return added;
  }
  return { items, loading, add };
}

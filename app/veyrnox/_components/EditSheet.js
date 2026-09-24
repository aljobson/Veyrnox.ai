'use client';
import { useEffect, useRef, useState } from 'react';
import { useAssetUrl } from '../_lib/useAssetUrl';
import { Modal } from './Modal';
import { AssetLoadStatus } from './AssetLoadStatus';
import { gatewayFetch, GatewayError, makeIdempotencyKey } from '../_lib/gateway';

// Clip Editor sheet (docs/editor/PRD.md §4). The server re-checks every
// number here against the stored files (lib/clipEditSources.js); this only
// saves the user a refused request.
const MAX_OUTPUT_S = 60;
const UNIT_S = 5;

const ERRORS = {
  mixed_aspect: 'These clips have different shapes. Pick clips that are all portrait or all landscape.',
  clip_range: 'An in or out point is past the end of its clip.',
  too_long: `An edit can be at most ${MAX_OUTPUT_S} seconds long.`,
  nothing_to_do: 'Trim the clip or add audio: as it stands the result would be the same video.',
  asset_not_found: 'One of these files is no longer available.',
  insufficient_balance: 'Not enough credits for this edit.',
  rate_limited: 'Too many requests. Wait a minute and try again.',
  model_not_found: 'The editor is not open yet.',
};

const round = (n) => Math.round(n * 100) / 100;

/**
 * @param {{ clips: {job_id:string, asset_url:string, name?:string}[], audios: {job_id:string, name?:string}[],
 *           credits5s: number|null, onClose: () => void, onSubmitted: (job:object) => void }} props
 */
export function EditSheet({ clips, audios, credits5s, onClose, onSubmitted }) {
  const [items, setItems] = useState(() => clips.map((c, i) => ({ ...c, uid: `${c.job_id}#${i}`, in_s: 0, out_s: null, duration: null, ratio: null })));
  const [audioId, setAudioId] = useState('');
  const [offset, setOffset] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);



  const update = (i, patch) => setItems((xs) => xs.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  const move = (i, d) => setItems((xs) => {
    const j = i + d;
    if (j < 0 || j >= xs.length) return xs;
    const next = [...xs];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });
  const remove = (i) => setItems((xs) => xs.filter((_, k) => k !== i));

  const loaded = items.every((x) => x.duration != null);
  const output = round(items.reduce((s, x) => s + Math.max(0, (x.out_s ?? 0) - x.in_s), 0));
  const mixed = new Set(items.filter((x) => x.ratio).map((x) => x.ratio)).size > 1;
  const badRange = items.some((x) => x.duration != null && !(x.in_s >= 0 && x.out_s > x.in_s && x.out_s <= x.duration));
  const noop = items.length === 1 && !audioId && loaded && items[0].in_s === 0 && items[0].out_s >= items[0].duration;
  // The same unit count the gateway bills (lib/clipEdit.js editUnits): a
  // many-clip edit costs per step, so steps set the floor under the length.
  const steps = items.filter((x) => !(x.duration != null && x.in_s === 0 && x.out_s >= x.duration)).length
    + (items.length > 1 ? 1 : 0) + (audioId ? 1 : 0);
  const units = Math.max(1, Math.ceil(output / UNIT_S), steps);
  const cost = credits5s != null && output > 0 ? credits5s * units : null;
  const blocked = !items.length || !loaded || mixed || badRange || noop || output > MAX_OUTPUT_S || cost == null || busy;

  async function submit() {
    if (blocked) return;
    setBusy(true);
    setError(null);
    const inputs = {
      clips: items.map((x) => ({ asset_id: x.job_id, in_s: round(x.in_s), out_s: round(x.out_s) })),
      ...(audioId ? { audio: { asset_id: audioId, offset_s: round(Number(offset) || 0) } } : {}),
    };
    try {
      const r = await gatewayFetch('/generations', {
        method: 'POST',
        body: JSON.stringify({ model_id: 'clip-edit', idempotency_key: makeIdempotencyKey(), inputs }),
      });
      onSubmitted({ job_id: r.job_id, credits: cost, balance_after: r.balance_after, name: `Edit · ${items.length} clip${items.length > 1 ? 's' : ''}` });
    } catch (e) {
      setError(e instanceof GatewayError ? e.code : 'internal');
      setBusy(false);
    }
  }

  return (
    <Modal aria-labelledby="edit-sheet-title" onCancel={() => !busy && onClose()} className="items-end sm:items-center justify-center p-0 sm:p-6">
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-[760px] max-h-[92dvh] overflow-y-auto rounded-t-2xl sm:rounded-2xl border border-vx-border bg-vx-base p-4 sm:p-6"
      >
        <div className="flex items-center justify-between mb-4">
          <h2 id="edit-sheet-title" className="text-xl font-black">Edit {items.length} clip{items.length === 1 ? '' : 's'}</h2>
          <button onClick={onClose} disabled={busy} aria-label="Close" className="text-vx-fg-muted hover:text-vx-fg px-2 py-1">✕</button>
        </div>

        <ol className="flex flex-col gap-3">
          {items.map((x, i) => (
            <ClipRow key={x.uid} item={x} index={i} count={items.length}
              onChange={(p) => update(i, p)} onMove={(d) => move(i, d)} onRemove={() => remove(i)} />
          ))}
        </ol>

        <div className="mt-4 rounded-xl border border-vx-border bg-vx-panel p-3 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs text-vx-fg-muted grow min-w-[200px]">
            Audio (optional)
            <select value={audioId} onChange={(e) => setAudioId(e.target.value)} className="rounded-lg bg-vx-base border border-vx-border px-2 py-2 text-sm text-vx-fg">
              <option value="">No audio</option>
              {audios.map((a) => <option key={a.job_id} value={a.job_id}>{a.name || a.job_id.slice(0, 8)}</option>)}
            </select>
          </label>
          {audioId && (
            <label className="flex flex-col gap-1 text-xs text-vx-fg-muted">
              Start at (s)
              <input type="number" min={0} step={0.1} value={offset} onChange={(e) => setOffset(e.target.value)}
                className="w-24 rounded-lg bg-vx-base border border-vx-border px-2 py-2 text-sm text-vx-fg" />
            </label>
          )}
          {audioId && <p className="text-xs text-vx-fg-muted basis-full">The audio is cut to the video&rsquo;s length.</p>}
        </div>

        <div role="status" className="mt-3 text-sm min-h-[1.25rem]">
          {mixed && <span className="text-vx-danger">{ERRORS.mixed_aspect}</span>}
          {!mixed && output > MAX_OUTPUT_S && <span className="text-vx-danger">{ERRORS.too_long}</span>}
          {!mixed && badRange && <span className="text-vx-danger">{ERRORS.clip_range}</span>}
          {noop && <span className="text-vx-fg-muted">{ERRORS.nothing_to_do}</span>}
          {error && <span className="text-vx-danger">{ERRORS[error] || 'That didn’t work. Your credits were not taken; try again.'}</span>}
        </div>

        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="font-vx-mono text-xs text-vx-fg-muted vx-num">{output.toFixed(1)} s output</span>
          <button onClick={submit} disabled={blocked}
            className="rounded-full px-5 py-2.5 font-bold bg-vx-accent text-vx-accent-ink disabled:opacity-40">
            {busy ? 'Starting…' : cost == null ? 'Create video' : `Create video · ${cost} cr`}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function ClipRow({ item, index, count, onChange, onMove, onRemove }) {
  const asset = useAssetUrl(item.job_id, item.asset_url);
  const ref = useRef(null);
  const d = item.duration;
  const setPoint = (key, v) => onChange({ [key]: Math.max(0, Math.min(d ?? 0, Number(v) || 0)) });
  return (
    <li className="rounded-xl border border-vx-border bg-vx-panel p-3 flex flex-col sm:flex-row gap-3">
      <div className="relative w-full sm:w-44 shrink-0">
        <video ref={ref} src={asset.url} onError={asset.onError} controls muted playsInline preload="metadata"
          className="w-full aspect-video sm:aspect-auto sm:h-28 bg-black rounded-lg object-contain"
          onLoadedMetadata={(e) => {
            asset.onLoad();
            const v = e.currentTarget;
            onChange({ duration: v.duration, out_s: item.out_s ?? v.duration, ratio: v.videoHeight ? (v.videoWidth / v.videoHeight).toFixed(2) : null });
          }} />
        <AssetLoadStatus asset={asset} />
      </div>
      <div className="flex-1 min-w-0 flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-bold truncate">{index + 1}. {item.name || item.job_id.slice(0, 8)}</span>
          <span className="flex gap-1 shrink-0">
            <button onClick={() => onMove(-1)} disabled={index === 0} aria-label="Move earlier" className="px-2 py-1 rounded border border-vx-border disabled:opacity-30">↑</button>
            <button onClick={() => onMove(1)} disabled={index === count - 1} aria-label="Move later" className="px-2 py-1 rounded border border-vx-border disabled:opacity-30">↓</button>
            <button onClick={onRemove} aria-label="Remove from edit" className="px-2 py-1 rounded border border-vx-border">✕</button>
          </span>
        </div>
        {['in_s', 'out_s'].map((key) => (
          <div key={key} className="flex items-center gap-2 text-xs text-vx-fg-muted">
            <label className="flex items-center gap-2">
              <span className="w-8">{key === 'in_s' ? 'In' : 'Out'}</span>
              <input type="number" min={0} max={d ?? undefined} step={0.1} disabled={d == null}
                value={item[key] == null ? '' : round(item[key])} onChange={(e) => setPoint(key, e.target.value)}
                className="w-24 rounded-lg bg-vx-base border border-vx-border px-2 py-1.5 text-sm text-vx-fg" />
            </label>
            <button disabled={d == null} onClick={() => setPoint(key, ref.current ? ref.current.currentTime : 0)}
              className="rounded-full border border-vx-border px-3 py-1 hover:text-vx-fg disabled:opacity-40">
              Set to playhead
            </button>
          </div>
        ))}
        {d != null && <span className="font-vx-mono text-[11px] text-vx-fg-muted vx-num">{round(d)} s clip</span>}
      </div>
    </li>
  );
}

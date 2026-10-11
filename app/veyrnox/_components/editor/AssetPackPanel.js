'use client';
import { useEffect, useRef, useState } from 'react';
import { Button } from '../Button';
import { ASSET_PACK_LIMITS, parseAssetPack, matchingPackAssets, verifyPackFile, createAssetPack } from '../../_lib/editorAssetPacks.mjs';
const field = 'w-full rounded border border-vx-border bg-vx-base p-2 text-xs';
export function AssetPackPanel({ disabled, onIngest }) {
    const [pack, setPack] = useState(null), [files, setFiles] = useState([]), [query, setQuery] = useState(''), [category, setCategory] = useState('All'), [acknowledged, setAcknowledged] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [status, setStatus] = useState(''), [download, setDownload] = useState(null);
    const [name, setName] = useState('My asset pack'), [credit, setCredit] = useState(''), [usage, setUsage] = useState(''), [url, setUrl] = useState('');
    const alive = useRef(true), operation = useRef(null);
    useEffect(() => { alive.current = true; return () => { alive.current = false; operation.current?.abort(); }; }, []);
    useEffect(() => () => { if (download) URL.revokeObjectURL(download); }, [download]);
    async function load(event) {
        const file = event.target.files[0]; event.target.value = ''; if (!file) return;
        const controller = new AbortController(); operation.current?.abort(); operation.current = controller;
        setBusy(true); setError(''); setStatus('');
        try {
            if (file.size > ASSET_PACK_LIMITS.manifestBytes) throw new Error('Choose an asset pack under 128 KiB.');
            const parsed = parseAssetPack(await file.text()); if (!alive.current || controller.signal.aborted) return;
            if (parsed.error) throw new Error(parsed.error);
            setPack(parsed.pack); setAcknowledged(false); setQuery(''); setCategory('All'); setDownload(null);
        } catch (e) { if (alive.current && !controller.signal.aborted) setError(e.message); }
        finally { if (operation.current === controller) { operation.current = null; if (alive.current) setBusy(false); } }
    }
    function selectFiles(event) {
        const chosen = Array.from(event.target.files || []); event.target.value = ''; setError(''); setStatus('');
        if (chosen.length > 40 || chosen.reduce((sum, file) => sum + file.size, 0) > ASSET_PACK_LIMITS.totalBytes) { setError('Choose up to 40 files totalling 256 MiB.'); return; }
        setFiles(chosen);
    }
    async function create() {
        const controller = new AbortController(); operation.current = controller; setBusy(true); setError(''); setStatus('');
        try { const result = await createAssetPack(files, { name, credit, usage, url, signal: controller.signal }); if (alive.current && !controller.signal.aborted) { setPack(result); setAcknowledged(false); setDownload(URL.createObjectURL(new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' }))); setStatus('Asset pack created. Recorded usage rights are supplied by you.'); } }
        catch (e) { if (alive.current && e.name !== 'AbortError') setError(e.message); }
        finally { if (operation.current === controller) { operation.current = null; if (alive.current) setBusy(false); } }
    }
    async function insert(asset) {
        const controller = new AbortController(); operation.current = controller; setBusy(true); setError(''); setStatus('');
        try { const result = await verifyPackFile(pack, asset.id, files, { signal: controller.signal }); if (!alive.current || controller.signal.aborted) return; await onIngest(result.file, result.name, undefined, undefined, result.details); if (alive.current && !controller.signal.aborted) setStatus(`${asset.name} inserted with its source and usage metadata.`); }
        catch (e) { if (alive.current && e.name !== 'AbortError') setError(e.message); }
        finally { if (operation.current === controller) { operation.current = null; if (alive.current) setBusy(false); } }
    }
    const assets = pack ? matchingPackAssets(pack, { query, category }) : [];
    return <section aria-label="Local catalog plugins" className="space-y-3"><h2 className="text-sm font-bold">Asset pack plugins</h2><p className="text-xs text-vx-fg-muted">Browse your own or licensed files with a catalog manifest. Packs can describe media and credits; they cannot run code or connect to accounts. Files stay on this device until you use a separate upload action.</p>
        <label className="block cursor-pointer rounded border border-dashed border-vx-border p-3 text-xs">Open asset-pack JSON<input aria-label="Open asset-pack JSON" className="sr-only" type="file" accept=".json,application/json" disabled={disabled || busy} onChange={load} /></label>
        <label className="block cursor-pointer rounded border border-dashed border-vx-border p-3 text-xs">Select pack media files<input aria-label="Select pack media files" className="sr-only" type="file" multiple accept="video/mp4,video/quicktime,video/webm,audio/mpeg,audio/wav,audio/mp4,audio/ogg,image/png,image/jpeg,image/webp" disabled={disabled || busy} onChange={selectFiles} /></label><p className="text-xs text-vx-fg-muted">{files.length} local files selected. Reopened projects ask you to relink these files.</p>
        <details><summary className="cursor-pointer text-xs font-bold">Create an asset pack from my files</summary><fieldset disabled={disabled || busy} className="mt-2 space-y-2"><label className="block text-xs">Pack name<input aria-label="Asset pack name" className={field} maxLength={40} value={name} onChange={e => setName(e.target.value)} /></label><label className="block text-xs">Creator or credit<input aria-label="Asset pack creator" className={field} maxLength={120} value={credit} onChange={e => setCredit(e.target.value)} /></label><label className="block text-xs">Usage rights<input aria-label="Asset pack usage rights" className={field} maxLength={240} placeholder="e.g. My original work; commercial use allowed" value={usage} onChange={e => setUsage(e.target.value)} /></label><label className="block text-xs">Source or licence URL<input aria-label="Asset pack licence URL" className={field} maxLength={1000} value={url} onChange={e => setUrl(e.target.value)} /></label><Button size="sm" disabled={!files.length} onClick={create}>Create catalog manifest</Button></fieldset></details>
        {download && <a href={download} download="asset-pack.json" className="text-xs underline">Download asset-pack JSON</a>}
        {pack && <><h3 className="text-xs font-bold">{pack.name}</h3><label className="flex items-start gap-2 text-xs"><input aria-label="Confirm asset pack usage rights" type="checkbox" disabled={disabled || busy} checked={acknowledged} onChange={e => setAcknowledged(e.target.checked)} />I have the rights to use the files in this edit. The catalog records my supplied terms.</label><input aria-label="Search asset pack" className={field} value={query} onChange={e => setQuery(e.target.value)} /><select aria-label="Asset pack category" className={field} value={category} onChange={e => setCategory(e.target.value)}>{['All', 'Photos', 'Video', 'Stickers', 'Avatars', 'Music', 'Sound effects'].map(item => <option key={item}>{item}</option>)}</select><p role="status" className="text-xs">{assets.length} matching catalog items</p>{assets.map(asset => <article key={asset.id} className="space-y-1 rounded border border-vx-border p-2"><h4 className="text-xs font-bold">{asset.name}</h4><p className="text-[10px] text-vx-fg-muted">{asset.category} · {asset.attribution.credit}</p><p className="text-[10px]">{asset.attribution.usage}</p>{asset.attribution.url && <a href={asset.attribution.url} target="_blank" rel="noopener noreferrer" className="text-[10px] underline">Recorded source or licence</a>}<Button size="sm" aria-label={`Insert catalog item ${asset.name}`} disabled={disabled || busy || !acknowledged} onClick={() => insert(asset)}>Insert</Button></article>)}</>}
        {error && <p role="alert" className="text-xs">{error}</p>}{status && <p role="status" className="text-xs">{status}</p>}{busy && <p role="status" className="text-xs">Checking selected local files…</p>}{busy && <Button size="sm" variant="ghost" onClick={() => operation.current?.abort()}>Cancel catalog operation</Button>}
    </section>;
}

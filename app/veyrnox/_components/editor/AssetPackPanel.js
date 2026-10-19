'use client';
import { helperCopy } from '../../../../lib/i18n/helperCopy.mjs';
import { useI18n } from '../../../../components/I18nProvider';
import { localeTag } from '../../../../lib/i18n/locales.mjs';
import { pluralKey, tOr } from '../../../../lib/i18n/translate.mjs';
import { useEffect, useRef, useState } from 'react';
import { Button } from '../Button';
import { ASSET_PACK_CATEGORIES, ASSET_PACK_LIMITS, parseAssetPack, matchingPackAssets, verifyPackFile, createAssetPack } from '../../_lib/editorAssetPacks.mjs';
const CATEGORIES = ['All', ...ASSET_PACK_CATEGORIES];
const field = 'w-full rounded border border-vx-border bg-vx-base p-2 text-xs';
export function AssetPackPanel({ disabled, onIngest }) {
  const { t, locale } = useI18n();
  const number = n => locale === 'en' ? String(n) : n.toLocaleString(localeTag(locale));
    const [pack, setPack] = useState(null), [files, setFiles] = useState([]), [query, setQuery] = useState(''), [category, setCategory] = useState('All'), [acknowledged, setAcknowledged] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [status, setStatus] = useState(''), [download, setDownload] = useState(null);
    const [name, setName] = useState(t("app.editor.pack.defaultName")), [credit, setCredit] = useState(''), [usage, setUsage] = useState(''), [url, setUrl] = useState('');
    const alive = useRef(true), operation = useRef(null);
    useEffect(() => { alive.current = true; return () => { alive.current = false; operation.current?.abort(); }; }, []);
    useEffect(() => () => { if (download) URL.revokeObjectURL(download); }, [download]);
    async function load(event) {
        const file = event.target.files[0]; event.target.value = ''; if (!file) return;
        const controller = new AbortController(); operation.current?.abort(); operation.current = controller;
        setBusy(true); setError(''); setStatus('');
        try {
            if (file.size > ASSET_PACK_LIMITS.manifestBytes) throw new Error(t("app.editor.pack.manifestLimit"));
            const parsed = parseAssetPack(await file.text()); if (!alive.current || controller.signal.aborted) return;
            if (parsed.error) throw new Error(parsed.error);
            setPack(parsed.pack); setAcknowledged(false); setQuery(''); setCategory('All'); setDownload(null);
        } catch (e) { if (alive.current && !controller.signal.aborted) setError(e.message); }
        finally { if (operation.current === controller) { operation.current = null; if (alive.current) setBusy(false); } }
    }
    function selectFiles(event) {
        const chosen = Array.from(event.target.files || []); event.target.value = ''; setError(''); setStatus('');
        if (chosen.length > 40 || chosen.reduce((sum, file) => sum + file.size, 0) > ASSET_PACK_LIMITS.totalBytes) { setError(t("app.editor.pack.filesLimit")); return; }
        setFiles(chosen);
    }
    async function create() {
        const controller = new AbortController(); operation.current = controller; setBusy(true); setError(''); setStatus('');
        try { const result = await createAssetPack(files, { name, credit, usage, url, signal: controller.signal }); if (alive.current && !controller.signal.aborted) { setPack(result); setAcknowledged(false); setDownload(URL.createObjectURL(new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' }))); setStatus(t("app.editor.pack.created")); } }
        catch (e) { if (alive.current && e.name !== 'AbortError') setError(e.message); }
        finally { if (operation.current === controller) { operation.current = null; if (alive.current) setBusy(false); } }
    }
    async function insert(asset) {
        const controller = new AbortController(); operation.current = controller; setBusy(true); setError(''); setStatus('');
        try { const result = await verifyPackFile(pack, asset.id, files, { signal: controller.signal }); if (!alive.current || controller.signal.aborted) return; await onIngest(result.file, result.name, undefined, undefined, result.details); if (alive.current && !controller.signal.aborted) setStatus(t('app.editor.pack.inserted', { name: asset.name })); }
        catch (e) { if (alive.current && e.name !== 'AbortError') setError(e.message); }
        finally { if (operation.current === controller) { operation.current = null; if (alive.current) setBusy(false); } }
    }
    const assets = pack ? matchingPackAssets(pack, { query, category }) : [];
    return <section aria-label={t("app.editor.pack.region")} className="space-y-3"><h2 className="text-sm font-bold">{t("app.editor.pack.title")}</h2><p className="text-xs text-vx-fg-muted">{t("app.editor.pack.help")}</p>
        <label className="block cursor-pointer rounded border border-dashed border-vx-border p-3 text-xs">{t("app.editor.pack.open")}<input aria-label={t("app.editor.pack.open")} className="sr-only" type="file" accept=".json,application/json" disabled={disabled || busy} onChange={load} /></label>
        <label className="block cursor-pointer rounded border border-dashed border-vx-border p-3 text-xs">{t("app.editor.pack.selectFiles")}<input aria-label={t("app.editor.pack.selectFiles")} className="sr-only" type="file" multiple accept="video/mp4,video/quicktime,video/webm,audio/mpeg,audio/wav,audio/mp4,audio/ogg,image/png,image/jpeg,image/webp" disabled={disabled || busy} onChange={selectFiles} /></label><p className="text-xs text-vx-fg-muted">{t(pluralKey(t, locale, 'app.editor.pack.selected', files.length), { count: number(files.length) })}</p>
        <details><summary className="cursor-pointer text-xs font-bold">{t("app.editor.pack.create")}</summary><fieldset disabled={disabled || busy} className="mt-2 space-y-2"><label className="block text-xs">{t("app.editor.pack.name")}<input aria-label={t("app.editor.pack.nameLabel")} className={field} maxLength={40} value={name} onChange={e => setName(e.target.value)} /></label><label className="block text-xs">{t("app.editor.pack.creator")}<input aria-label={t("app.editor.pack.creatorLabel")} className={field} maxLength={120} value={credit} onChange={e => setCredit(e.target.value)} /></label><label className="block text-xs">{t("app.editor.pack.rights")}<input aria-label={t("app.editor.pack.rightsLabel")} className={field} maxLength={240} placeholder={t("app.editor.pack.rightsExample")} value={usage} onChange={e => setUsage(e.target.value)} /></label><label className="block text-xs">{t("app.editor.pack.url")}<input aria-label={t("app.editor.pack.urlLabel")} className={field} maxLength={1000} value={url} onChange={e => setUrl(e.target.value)} /></label><Button size="sm" disabled={!files.length} onClick={create}>{t("app.editor.pack.manifest")}</Button></fieldset></details>
        {download && <a href={download} download="asset-pack.json" className="text-xs underline">{t("app.editor.pack.download")}</a>}
        {pack && <><h3 className="text-xs font-bold">{pack.name}</h3><label className="flex items-start gap-2 text-xs"><input aria-label={t("app.editor.pack.confirmLabel")} type="checkbox" disabled={disabled || busy} checked={acknowledged} onChange={e => setAcknowledged(e.target.checked)} />{t("app.editor.pack.confirm")}</label><input aria-label={t("app.editor.pack.search")} className={field} value={query} onChange={e => setQuery(e.target.value)} /><select aria-label={t("app.editor.pack.category")} className={field} value={category} onChange={e => setCategory(e.target.value)}>{CATEGORIES.map(item => <option key={item} value={item}>{t(`app.editor.pack.category.${item}`)}</option>)}</select><p role="status" className="text-xs">{t(pluralKey(t, locale, 'app.editor.pack.matches', assets.length), { count: number(assets.length) })}</p>{assets.map(asset => <article key={asset.id} className="space-y-1 rounded border border-vx-border p-2"><h4 className="text-xs font-bold">{asset.name}</h4><p className="text-[10px] text-vx-fg-muted">{tOr(t, `app.editor.pack.category.${asset.category}`, asset.category)} · {asset.attribution.credit}</p><p className="text-[10px]">{asset.attribution.usage}</p>{asset.attribution.url && <a href={asset.attribution.url} target="_blank" rel="noopener noreferrer" className="text-[10px] underline">{t("app.editor.pack.source")}</a>}<Button size="sm" aria-label={t('app.editor.pack.insertLabel', { name: asset.name })} disabled={disabled || busy || !acknowledged} onClick={() => insert(asset)}>{t("app.editor.pack.insert")}</Button></article>)}</>}
        {error && <p role="alert" className="text-xs">{helperCopy(t, locale, error)}</p>}{status && <p role="status" className="text-xs">{status}</p>}{busy && <p role="status" className="text-xs">{t("app.editor.pack.checking")}</p>}{busy && <Button size="sm" variant="ghost" onClick={() => operation.current?.abort()}>{t("app.editor.pack.cancel")}</Button>}
    </section>;
}

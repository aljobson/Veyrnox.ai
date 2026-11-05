'use client';
import { useCallback, useEffect, useState } from 'react';
import { useI18n } from '../../../../components/I18nProvider';
import { tOr } from '../../../../lib/i18n/translate.mjs';
import { gatewayFetch } from '../../_lib/gateway.js';
import { deleteSocialPreset, listSocialPresets, saveSocialPreset } from '../../../lib/socialPresetsClient.js';
const button = 'rounded-full border border-vx-border px-4 py-2 text-sm font-bold disabled:opacity-50';
export function ContentPresets({ accounts, caption, selectedAccountIds, onApply }) {
  const { t } = useI18n();
    const [presets, setPresets] = useState(null);
    const [selectedId, setSelectedId] = useState('');
    const [name, setName] = useState('');
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');

    const load = useCallback(async () => {
        try {
            const result = await listSocialPresets();
            setPresets(result.presets || []);
        } catch {
            setError(t("app.publish.composer.presetsLoad"));
        }
    }, [t]);
    useEffect(() => { load(); }, [load]);

    function apply() {
        const preset = (presets || []).find((item) => item.id === selectedId);
        if (!preset) { setError(t("app.publish.composer.presetFirst")); return; }
        const availableIds = new Set(accounts.map((account) => account.id));
        onApply(preset.caption, (preset.account_ids || []).filter((id) => availableIds.has(id)));
        setName(preset.name); setError('');
        setMessage(t("app.publish.composer.presetLoaded"));
    }

    async function save() {
        const cleanName = name.trim();
        if (!cleanName) { setError(t("app.publish.composer.presetNameRequired")); return; }
        if (!caption) { setError(t("app.publish.composer.presetCaptionRequired")); return; }
        setBusy(true); setError(''); setMessage('');
        try {
            const existing = (presets || []).find((item) => item.id === selectedId);
            const result = await saveSocialPreset({ id: existing?.id || null, name: cleanName, caption, accountIds: [...selectedAccountIds] });
            await load(); setSelectedId(result.preset_id); setMessage(existing ? t("app.publish.composer.presetUpdated") : t("app.publish.composer.presetSaved"));
        } catch (err) {
            setError(err?.body?.error === 'preset_name_taken' ? t("app.publish.composer.presetExists") : t("app.publish.composer.presetSaveFailed"));
        } finally { setBusy(false); }
    }

    async function remove() {
        if (!selectedId) { setError(t("app.publish.composer.presetFirst")); return; }
        setBusy(true); setError(''); setMessage('');
        try {
            await deleteSocialPreset(selectedId);
            setSelectedId(''); setName(''); await load(); setMessage(t("app.publish.composer.presetDeleted"));
        } catch { setError(t("app.publish.composer.presetDeleteFailed")); }
        finally { setBusy(false); }
    }

    return <section aria-label={t("app.publish.composer.presets")} className="rounded-xl border border-vx-border p-3 space-y-3">
        <div>
            <h3 className="text-sm font-bold">{t("app.publish.composer.presetsHeading")}</h3>
            <p className="text-xs text-vx-fg-muted">{t("app.publish.composer.presetsIntro")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
            <select aria-label={t("app.publish.composer.preset")} value={selectedId} disabled={busy || presets === null} onChange={(e) => { const id=e.target.value; setSelectedId(id); setName((presets || []).find((item)=>item.id===id)?.name || ''); setError(''); setMessage(''); }} className="min-w-48 rounded-lg border border-vx-border bg-transparent px-3 py-2 text-sm">
                <option value="">{presets === null ? t("app.publish.composer.presetsLoading") : presets.length ? t("app.publish.composer.presetChoose") : t("app.publish.composer.presetsEmpty")}</option>
                {(presets || []).map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
            </select>
            <button type="button" className={button} disabled={busy || !selectedId} onClick={apply}>{t("app.publish.composer.presetApply")}</button>
            <button type="button" className={button} disabled={busy || !selectedId} onClick={remove}>{t("app.publish.composer.delete")}</button>
        </div>
        <div className="flex flex-wrap gap-2">
            <label htmlFor="preset-name" className="sr-only">{t("app.publish.composer.presetName")}</label>
            <input id="preset-name" value={name} maxLength={80} onChange={(e)=>setName(e.target.value)} placeholder={t("app.publish.composer.presetName")} className="min-w-56 flex-1 rounded-lg border border-vx-border bg-transparent px-3 py-2 text-sm" />
            <button type="button" className={button} disabled={busy} onClick={save}>{busy ? t("social.saving") : selectedId ? t("app.publish.composer.presetUpdate") : t("app.publish.composer.saveCurrent")}</button>
        </div>
        {error && <p role="alert" className="text-sm text-vx-danger">{error}</p>}
        {message && <p role="status" className="text-sm text-vx-accent">{message}</p>}
    </section>;
}

/** The account's own recent library, ordered selection for the composer. */
export function MediaPicker({ selected, onSelect, disabled }) {
  const { t } = useI18n();
    const [jobs, setJobs] = useState(null);
    const [thumbs, setThumbs] = useState({});
    const [loadError, setLoadError] = useState('');

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res = await gatewayFetch('/jobs?limit=24');
                const withAssets = (res.jobs || []).filter((j) => j.has_asset);
                if (cancelled) return;

                const entries = await Promise.all(withAssets.map(async (j) => {
                    try {
                        const asset = await gatewayFetch(`/jobs/${encodeURIComponent(j.job_id)}/asset`);
                        return [j.job_id, { url: asset.url, mediaType: asset.mime_type?.split('/')[0] }];
                    } catch {
                        return [j.job_id, null];
                    }
                }));
                if (!cancelled) {
                    const loaded = Object.fromEntries(entries);
                    setThumbs(loaded);
                    setJobs(withAssets.filter((j) => ['image', 'video'].includes(loaded[j.job_id]?.mediaType)));
                }
            } catch {
                if (!cancelled) setLoadError(t("app.publish.composer.libraryLoad"));
            }
        })();
        return () => { cancelled = true; };
    }, [t]);

    if (loadError) return <p role="alert" className="text-sm text-vx-danger">{loadError}</p>;
    if (jobs === null) return <p className="text-sm text-vx-fg-muted">{t("app.library.loading")}</p>;
    if (jobs.length === 0) return <p className="text-sm text-vx-fg-muted">{t("app.publish.composer.libraryEmpty")}</p>;

    return (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 max-h-64 overflow-y-auto">
            {jobs.map((j) => {
                const isSelected = selected.some(item => item.jobId === j.job_id);
                return (
                    <button
                        key={j.job_id}
                        disabled={disabled}
                        type="button"
                        aria-label={t('app.publish.composer.chooseMedia', { type: tOr(t, `app.publish.composer.media.${thumbs[j.job_id]?.mediaType}`, t('app.publish.composer.mediaFallback')), id: j.job_id.slice(0, 8) })}
                        aria-pressed={isSelected}
                        onClick={() => onSelect({ jobId: j.job_id, thumbUrl: thumbs[j.job_id]?.url, mediaType: thumbs[j.job_id]?.mediaType })}
                        className={`relative aspect-square rounded-lg overflow-hidden border-2 ${isSelected ? 'border-vx-accent' : 'border-vx-border'}`}
                    >
                        {thumbs[j.job_id]
                            ? thumbs[j.job_id]?.mediaType === 'video'
                                ? <video src={thumbs[j.job_id]?.url} muted playsInline preload="metadata" className="h-full w-full object-cover" />
                                : <img loading="lazy" decoding="async" src={thumbs[j.job_id]?.url} alt="" className="h-full w-full object-cover" />
                            : <span className="flex h-full w-full items-center justify-center bg-vx-panel text-xs text-vx-fg-muted">…</span>}
                        {isSelected && <span aria-hidden="true" className="absolute inset-0 bg-vx-accent/20" />}
                    </button>
                );
            })}
        </div>
    );
}


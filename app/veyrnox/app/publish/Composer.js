'use client';
import { tOr } from '../../../../lib/i18n/translate.mjs';
import { localeTag } from '../../../../lib/i18n/locales.mjs';
import { useI18n } from '../../../../components/I18nProvider';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import DeviceUploads from './DeviceUploads.js';
import CarouselSelection from './CarouselSelection.js';
import { orderedMediaSignature, selectionLimit, selectionBlocker, toggleMedia } from '../../../../lib/social/carouselSelection.js';
import NetworkLogo from './NetworkLogo.js';
import { gatewayFetch } from '../../_lib/gateway.js';
import { ownedPublishUpload } from '../../_lib/editorDelivery.mjs';
import { NETWORKS } from '../../../lib/socialConnectClient.js';
import { createSocialApproval, createSocialPost, listSocialPosts, newIdempotencyKey } from '../../../lib/socialPostsClient.js';
import { deleteSocialPreset, listSocialPresets, saveSocialPreset } from '../../../lib/socialPresetsClient.js';
import { confirmSocialQueueSlot, listSocialQueues, reserveSocialQueueSlot } from '../../../lib/socialQueuesClient.js';
import { futureLocalSchedule, localInput, minimumFutureLocalInput } from '../../../../lib/social/calendar.js';

const button = 'rounded-full border border-vx-border px-4 py-2 text-sm font-bold disabled:opacity-50';
const primaryButton = 'rounded-full bg-vx-accent text-black px-4 py-2 text-sm font-bold disabled:opacity-50';

function networkLabel(key) {
    return NETWORKS.find((n) => n.key === key)?.label || key;
}

function captionLength(network, value) {
    return network === 'bluesky'
        ? [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(value)].length
        : [...value].length;
}

function defaultScheduleValue() {
    return localInput(Date.now() + 60 * 60 * 1000);
}

function ContentPresets({ accounts, caption, selectedAccountIds, onApply }) {
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
function MediaPicker({ selected, onSelect, disabled }) {
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
                                : <img src={thumbs[j.job_id]?.url} alt="" className="h-full w-full object-cover" />
                            : <span className="flex h-full w-full items-center justify-center bg-vx-panel text-xs text-vx-fg-muted">…</span>}
                        {isSelected && <span aria-hidden="true" className="absolute inset-0 bg-vx-accent/20" />}
                    </button>
                );
            })}
        </div>
    );
}

export function Composer({ accounts, onScheduled, initialJobId = null, initialUploadId = null, reusablePost = null, uploadsEnabled = false, carouselEnabled = false, youtubeVisibilityEnabled = false, scheduleEnabled = true, multiAccountEnabled = true, presetsEnabled = false, queuesEnabled = false, approvalsEnabled = false, variantsEnabled = false }) {
  const { t, locale } = useI18n();
    const number = value => locale === 'en' ? value : Number(value).toLocaleString(localeTag(locale));
    const networkName = key => tOr(t, `app.publish.network.${key}`, networkLabel(key));
    const activeAccounts = (accounts || []).filter((a) => a.status === 'active' && a.publishingEnabled !== false && (a.supportedMedia || NETWORKS.find((n) => n.key === a.network)?.media.filter(type => type !== 'video' || a.network === 'youtube'))?.length);
    const [selectedAccountIds, setSelectedAccountIds] = useState(() => new Set());
    const [caption, setCaption] = useState('');
    const [networkText, setNetworkText] = useState({});
    const [previewNetwork, setPreviewNetwork] = useState('');
    const [youtubeVisibility, setYoutubeVisibility] = useState('private');
    const hasYoutube = activeAccounts.some((a) => a.network === 'youtube' && selectedAccountIds.has(a.id));
    const [scheduledAt, setScheduledAt] = useState(defaultScheduleValue);
    const [mediaItems, setMediaItems] = useState([]);
    const selectedMedia = mediaItems[0] || null;
    const hasTiktokVideo = mediaItems.some(item => item.mediaType === 'video') && activeAccounts.some(a => a.network === 'tiktok' && selectedAccountIds.has(a.id));
    const setSelectedMedia = item => setMediaItems(item ? [item] : []);
    const [loadingMedia, setLoadingMedia] = useState(!!initialJobId || !!initialUploadId);
    const [mediaError, setMediaError] = useState('');
    const [uploading, setUploading] = useState(false);
    const [pickerOpen, setPickerOpen] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [queues, setQueues] = useState(null);
    const [queueId, setQueueId] = useState('');
    const [reviewerEmails, setReviewerEmails] = useState('');
    const [approvalPolicy, setApprovalPolicy] = useState('all');
    const [reviewLinks, setReviewLinks] = useState([]);
    const idempotencyKey = useRef(newIdempotencyKey());

    useEffect(() => {
        if (!queuesEnabled) return;
        let active = true;
        listSocialQueues().then((result) => { if (active) setQueues((result.queues || []).filter((queue) => queue.enabled)); })
            .catch(() => { if (active) setQueues([]); });
        return () => { active = false; };
    }, [queuesEnabled]);

    useEffect(() => {
        if (!initialJobId) return;
        let cancelled = false;
        (async () => {
            try {
                if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(initialJobId)) throw new Error('invalid_job');
                const asset = await gatewayFetch(`/jobs/${encodeURIComponent(initialJobId)}/asset`);
                const type = asset.mime_type?.split('/')[0];
                if (!asset.url || !['image', 'video'].includes(type)) throw new Error('unsupported_media');
                if (cancelled) return;
                setSelectedMedia({ jobId: initialJobId, thumbUrl: asset.url, mediaType: type });
            } catch {
                if (!cancelled) setMediaError(t("app.publish.composer.jobUnavailable"));
            } finally {
                if (!cancelled) setLoadingMedia(false);
            }
        })();
        return () => { cancelled = true; };
    }, [initialJobId, t]);

    useEffect(() => {
        if (!initialUploadId || initialJobId) return;
        let active = true;
        Promise.resolve().then(async () => {
            if (!active) return null;
            if (!uploadsEnabled) throw new Error('uploads_disabled');
            setLoadingMedia(true);
            return ownedPublishUpload(gatewayFetch, initialUploadId);
        }).then(media => {
            if (active && media) { setSelectedMedia(media); setMediaError(''); }
        }).catch(() => { if (active) setMediaError(uploadsEnabled ? t("app.publish.composer.uploadUnavailable") : t("app.publish.composer.uploadClosed")); })
            .finally(() => { if (active) setLoadingMedia(false); });
        return () => { active = false; };
    }, [initialUploadId, initialJobId, uploadsEnabled, t]);

    useEffect(() => {
        if (!reusablePost?.reuseKey) return;
        let active = true;
        Promise.resolve().then(async () => {
            if (!active) return;
            const sources = reusablePost.media || [];
            setCaption(reusablePost.global_text || '');
            setNetworkText(Object.fromEntries((reusablePost.targets || []).filter((target) => target.text_override).map((target) => [target.network, target.text_override])));
            setSelectedAccountIds(new Set((reusablePost.targets || []).map((target) => target.account_id).filter((id) => activeAccounts.some((account) => account.id === id))));
            setSuccess(t("app.publish.composer.reused"));
            setError(''); setMediaError(''); setSelectedMedia(null);
            idempotencyKey.current = newIdempotencyKey();
            if (!sources.length) { setMediaError(t("app.publish.composer.noReusableMedia")); return; }
            setLoadingMedia(true);
            const media = await Promise.all(sources.map(source => source.job_id
                ? gatewayFetch(`/jobs/${encodeURIComponent(source.job_id)}/asset`).then(asset => ({ jobId: source.job_id, thumbUrl: asset.url, mediaType: source.media_type }))
                : uploadsEnabled && source.upload_id ? ownedPublishUpload(gatewayFetch, source.upload_id)
                    : Promise.reject(new Error('media_unavailable'))));
            if (active) { setMediaItems(media); }
        }).catch(() => { if (active) setMediaError(t("app.publish.composer.mediaUnavailable")); })
            .finally(() => { if (active) setLoadingMedia(false); });
        return () => { active = false; };
    // activeAccounts is derived from the account prop; the reuse key is the intentional trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [reusablePost?.reuseKey, uploadsEnabled, t]);

    const selectedAccounts = activeAccounts.filter(account => selectedAccountIds.has(account.id));
    const queueAccounts = activeAccounts.filter(account => (queues || []).find(queue => queue.id === queueId)?.account_ids.includes(account.id));
    const previewAccounts = queueId ? queueAccounts : selectedAccounts;
    const maxMedia = selectionLimit(previewAccounts, carouselEnabled);
    const blocker = selectionBlocker(previewAccounts, mediaItems, carouselEnabled);
    const blockerText = blocker ? blocker.network ? t('app.publish.carousel.blocked', { network: networkName(blocker.network) }) : t('app.publish.carousel.closed') : '';
    const signature = useRef('');
    function chooseMedia(item) {
        setMediaItems(old => toggleMedia(old, item, maxMedia));
        setMediaError('');
    }
    const selectedNetworks = [...new Set(activeAccounts.filter((account) => selectedAccountIds.has(account.id)).map((account) => account.network))];
    const activePreviewNetwork = selectedNetworks.includes(previewNetwork) ? previewNetwork : selectedNetworks[0] || '';

    function toggleAccount(id) {
        setSelectedAccountIds((prev) => {
            if (!multiAccountEnabled && !prev.has(id)) return new Set([id]);
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    }

    async function onSubmit(e) {
        e.preventDefault();
        setError(''); setSuccess(''); setReviewLinks([]);
        const mode = e.nativeEvent.submitter?.value;
        const destinations = mode === 'queue' ? queueAccounts : selectedAccounts;
        const submitBlocker = selectionBlocker(destinations, mediaItems, carouselEnabled);
        if (destinations.length === 0) { setError(t("app.publish.composer.pickAccount")); return; }
        if (submitBlocker) { setError(submitBlocker.network ? t('app.publish.carousel.blocked', { network: networkName(submitBlocker.network) }) : t('app.publish.carousel.closed')); return; }
        if (!selectedMedia) { setError(t("app.publish.composer.pickMedia")); return; }
        for (const account of destinations) {
            const network = NETWORKS.find((n) => n.key === account?.network);
            if (mediaItems.some(item => !(account?.supportedMedia || network?.media.filter(type => type !== 'video' || account?.network === 'youtube'))?.includes(item.mediaType))) { setError(t('app.publish.composer.unsupported', { network: network?.key ? networkName(network.key) : t('app.publish.composer.accountFallback') })); return; }
            const effectiveCaption = networkText[network.key] || caption;
            const length = captionLength(network.key, effectiveCaption);
            if (length > network.captionLimit) { setError(t('app.publish.composer.captionLimit', { network: networkName(network.key), count: number(network.captionLimit) })); return; }
        }
        const publishNow = mode === 'now';
        const useQueue = mode === 'queue';
        const useApproval = mode === 'review';
        if (useQueue && !queueId) { setError(t("app.publish.composer.queueRequired")); return; }
        const schedule = futureLocalSchedule(scheduledAt);
        if (!publishNow && !useQueue && !schedule) {
            setError(t("app.publish.composer.futureRequired")); return;
        }
        const reviewers = reviewerEmails.split(/[\n,;]/).map((email) => email.trim().toLowerCase()).filter(Boolean);
        if (useApproval && (reviewers.length < 1 || reviewers.length > 10 || reviewers.some((email) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))) {
            setError(t("app.publish.composer.reviewersRequired")); return;
        }
        const nextSignature = JSON.stringify([orderedMediaSignature(mediaItems), [...selectedAccountIds].sort(), caption, mode,
            publishNow ? null : useQueue ? queueId : scheduledAt, Object.entries(networkText).sort(([a], [b]) => a.localeCompare(b)),
            youtubeVisibility, useApproval ? [...reviewers].sort() : [], useApproval ? approvalPolicy : null]);
        if (signature.current !== nextSignature) { signature.current = nextSignature; idempotencyKey.current = newIdempotencyKey(); }
        setSubmitting(mode);
        try {
            const reservation = useQueue ? await reserveSocialQueueSlot(queueId, idempotencyKey.current) : null;
            if (reservation) {
                const reserved = reservation.account_ids.map(id => activeAccounts.find(account => account.id === id));
                if (reserved.some(account => !account)) { setError(t('app.publish.composer.pickAccount')); return; }
                const blocked = selectionBlocker(reserved, mediaItems, carouselEnabled);
                if (blocked) { setError(blocked.network ? t('app.publish.carousel.blocked', { network: networkName(blocked.network) }) : t('app.publish.carousel.closed')); return; }
            }
            const payload = {
                ...(publishNow ? { publishNow: true } : { scheduledAt: useQueue ? reservation.scheduled_at : schedule }),
                globalText: caption,
                ...(variantsEnabled ? { networkText: Object.fromEntries(Object.entries(networkText).filter(([network, text]) => selectedNetworks.includes(network) && text.trim())) } : {}),
                ...(hasYoutube && youtubeVisibilityEnabled ? { youtubeVisibility } : {}),
                idempotencyKey: idempotencyKey.current,
                accountIds: useQueue ? reservation.account_ids : [...selectedAccountIds],
                media: mediaItems.map(item => ({ mediaType: item.mediaType, ...(item.uploadId ? { uploadId: item.uploadId } : { jobId: item.jobId }) })),
            };
            const result = useApproval
                ? await createSocialApproval({ ...payload, reviewers, policy: approvalPolicy })
                : await createSocialPost(payload);
            if (reservation) await confirmSocialQueueSlot(reservation.assignment_id, result.post_id);
            setSuccess(useApproval ? t("app.publish.composer.reviewCreated") : publishNow ? t("app.publish.composer.queued") : useQueue ? t("app.publish.composer.queueAdded") : t("app.publish.composer.scheduled"));
            setReviewLinks(result.review_links || []);
            setCaption(''); setNetworkText({}); setPreviewNetwork(''); setSelectedAccountIds(new Set()); setSelectedMedia(null);
            setScheduledAt(defaultScheduleValue());
            setQueueId('');
            setYoutubeVisibility('private');
            if (!useApproval) setReviewerEmails('');
            idempotencyKey.current = newIdempotencyKey();
            onScheduled?.();
        } catch (err) {
            const code = err?.code === 'rate_limited' ? 'rate_limited' : err?.body?.error;
            setError(tOr(t, `app.publish.composer.error.${code}`, t('app.publish.composer.submitFailed')));
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <form onSubmit={onSubmit} className="space-y-4">
            <div>
                <div className="text-sm font-bold mb-2">{t("app.publish.composer.postTo")}</div>
                {!activeAccounts.length && <p className="text-sm text-vx-fg-muted">{t("app.publish.composer.connectFirst")}</p>}
                <ul className="flex flex-wrap gap-2">
                    {activeAccounts.map((a) => {
                        const on = selectedAccountIds.has(a.id);
                        return (
                            <li key={a.id}>
                                <button
                                    type="button"
                                    aria-pressed={on}
                                    data-testid={`publish-account-${a.id}`} onClick={() => toggleAccount(a.id)}
                                    className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-bold ${on ? 'border-vx-accent text-vx-accent' : 'border-vx-border text-vx-fg'}`}
                                >
                                    <NetworkLogo network={a.network} className="h-4 w-4" />
                                    {networkName(a.network)}: {a.display_name || a.external_account_id}
                                </button>
                            </li>
                        );
                    })}
                </ul>
                {!multiAccountEnabled && activeAccounts.length > 1 && <p className="mt-2 text-xs text-vx-fg-muted">{t("app.publish.composer.freeSingle")}{' '}<Link href="/app/publish/plan" className="font-bold text-vx-accent underline">{t("app.publish.composer.upgradeMulti")}</Link>.</p>}
            </div>

            {hasTiktokVideo && <p className="text-sm text-vx-fg-muted">{t("app.publish.composer.tiktokDraft")}</p>}

            {hasYoutube && <div>
                {youtubeVisibilityEnabled ? <>
                    <label htmlFor="youtube-visibility" className="text-sm font-bold mb-2 block">{t("app.publish.composer.youtubeVisibility")}</label>
                    <select id="youtube-visibility" value={youtubeVisibility} onChange={(e) => setYoutubeVisibility(e.target.value)} disabled={Boolean(submitting)} className="rounded-lg border border-vx-border bg-transparent px-3 py-2 text-sm">
                        <option value="private">{t("app.publish.composer.private")}</option>
                        <option value="unlisted">{t("app.publish.composer.unlisted")}</option>
                        <option value="public">{t("app.publish.composer.public")}</option>
                    </select>
                    <p className="text-sm text-vx-fg-muted mt-2">{youtubeVisibility === 'private' ? t("app.publish.composer.youtubePrivate") : youtubeVisibility === 'unlisted' ? t("app.publish.composer.youtubeUnlisted") : t("app.publish.composer.youtubePublic")}{' '}{t("app.publish.composer.youtubeOnly")}</p>
                </> : <p className="text-sm text-vx-fg-muted">{t("app.publish.composer.youtubePublicDefault")}</p>}
            </div>}

            <div>
                <label htmlFor="publish-caption" className="text-sm font-bold mb-2 block">{t("app.publish.composer.caption")}</label>
                <textarea
                    id="publish-caption" data-testid="publish-caption"
                    value={caption}
                    onChange={(e) => setCaption(e.target.value.slice(0, 4000))}
                    rows={4}
                    className="w-full rounded-xl border border-vx-border bg-transparent p-3 text-sm"
                    placeholder={t("app.publish.composer.writeCaption")}
                />
            </div>

            {variantsEnabled && selectedNetworks.length > 0 && <section aria-label={t("app.publish.composer.platformCaptions")} className="rounded-xl border border-vx-border p-4 space-y-3">
                <div>
                    <h3 className="text-sm font-bold">{t("app.publish.composer.customize")}</h3>
                    <p className="text-xs text-vx-fg-muted">{t("app.publish.composer.customizeIntro")}</p>
                </div>
                <div role="tablist" aria-label={t("app.publish.composer.platformPreview")} className="flex flex-wrap gap-2">
                    {selectedNetworks.map((network) => <button key={network} type="button" role="tab" aria-selected={activePreviewNetwork === network}
                        onClick={() => setPreviewNetwork(network)} className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-bold ${activePreviewNetwork === network ? 'border-vx-accent text-vx-accent' : 'border-vx-border'}`}>
                        <NetworkLogo network={network} className="h-4 w-4" />{networkName(network)}
                    </button>)}
                </div>
                {activePreviewNetwork && (() => {
                    const network = NETWORKS.find((item) => item.key === activePreviewNetwork);
                    const override = networkText[activePreviewNetwork] || '';
                    const effective = override || caption;
                    const length = captionLength(activePreviewNetwork, effective);
                    const names = activeAccounts.filter((account) => selectedAccountIds.has(account.id) && account.network === activePreviewNetwork).map((account) => account.display_name || account.external_account_id);
                    return <div className="grid gap-4 lg:grid-cols-2">
                        <div>
                            <label htmlFor={`platform-caption-${activePreviewNetwork}`} className="mb-2 block text-sm font-bold">{t('app.publish.composer.networkCaption', { network: networkName(network.key) })}</label>
                            <textarea id={`platform-caption-${activePreviewNetwork}`} rows={4} value={override}
                                onChange={(event) => setNetworkText((current) => ({ ...current, [activePreviewNetwork]: event.target.value }))}
                                placeholder={t('app.publish.composer.mainCaptionFor', { network: networkName(network.key) })} className="w-full rounded-xl border border-vx-border bg-transparent p-3 text-sm" />
                            <div className="mt-1 flex justify-between text-xs text-vx-fg-muted"><span>{override ? t("app.publish.composer.customCaption") : t("app.publish.composer.usingMain")}</span><span className={length > network.captionLimit ? 'text-vx-danger' : ''}>{number(length)} / {number(network.captionLimit)}</span></div>
                        </div>
                        <article aria-label={t('app.publish.composer.postPreview', { network: networkName(network.key) })} className="overflow-hidden rounded-xl border border-vx-border bg-vx-panel">
                            <header className="flex items-center gap-2 border-b border-vx-border p-3 text-sm font-bold"><NetworkLogo network={activePreviewNetwork} className="h-5 w-5" /><span>{names.join(', ')}</span></header>
                            {selectedMedia?.thumbUrl && (selectedMedia.mediaType === 'video'
                                ? <video src={selectedMedia.thumbUrl} muted playsInline preload="metadata" className="aspect-video w-full object-cover" />
                                : <img src={selectedMedia.thumbUrl} alt={t("app.publish.composer.selectedPreview")} className="aspect-video w-full object-cover" />)}
                            <p className="whitespace-pre-wrap break-words p-3 text-sm">{effective || t("app.publish.composer.captionPreview")}</p>
                        </article>
                    </div>;
                })()}
            </section>}

            {presetsEnabled && <ContentPresets accounts={activeAccounts} caption={caption} selectedAccountIds={selectedAccountIds}
                onApply={(nextCaption, accountIds) => { setCaption(nextCaption); setNetworkText({}); setPreviewNetwork(''); setSelectedAccountIds(new Set(accountIds)); setError(''); setSuccess(''); idempotencyKey.current = newIdempotencyKey(); }} />}

            <div>
                <div className="text-sm font-bold mb-2">{t("app.publish.composer.media")}</div>
                <div className="flex flex-wrap items-center gap-3 mb-2">
                    <button type="button" disabled={loadingMedia || uploading} className={button} onClick={() => setPickerOpen((v) => !v)}>
                        {selectedMedia ? t("app.publish.composer.change") : t("app.publish.composer.fromLibrary")}
                    </button>
                    {selectedMedia?.thumbUrl && (selectedMedia.mediaType === 'video'
                        ? <video src={selectedMedia.thumbUrl} aria-label={t("app.publish.composer.selectedVideo")} controls playsInline className="h-24 w-40 rounded-sm object-contain" />
                        : <img src={selectedMedia.thumbUrl} alt={t("app.publish.composer.selectedImage")} className="h-10 w-10 rounded-sm object-cover" />)}
                </div>
                {loadingMedia && <p role="status" className="text-sm text-vx-fg-muted">{t("app.publish.composer.loadingGeneration")}</p>}
                {mediaError && <p role="alert" className="text-sm text-vx-danger">{mediaError}</p>}
                <CarouselSelection items={mediaItems} onChange={setMediaItems} max={maxMedia} disabled={uploading || Boolean(submitting)} />
                {blockerText && <p role="alert" className="text-sm text-vx-danger">{blockerText}</p>}
                {uploadsEnabled && <DeviceUploads selected={mediaItems} max={maxMedia} onBusyChange={setUploading} onSelect={(items) => { setMediaItems(items); setMediaError(''); }} />}
                {pickerOpen && (
                    <MediaPicker
                        selected={mediaItems}
                        disabled={uploading || Boolean(submitting)}
                        onSelect={chooseMedia}
                    />
                )}
            </div>

            {scheduleEnabled ? <div>
                <label htmlFor="publish-schedule" className="text-sm font-bold mb-2 block">{t("app.publish.composer.scheduleFor")}</label>
                <input id="publish-schedule" type="datetime-local" min={minimumFutureLocalInput()} value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} className="rounded-lg border border-vx-border bg-transparent px-3 py-2 text-sm" />
                <p className="mt-1 text-xs text-vx-fg-muted">{t("app.publish.composer.localTime")}</p>
            </div> : <p className="rounded-xl border border-vx-accent/40 bg-vx-accent/[0.06] p-3 text-sm text-vx-fg-body">
                {t("app.publish.composer.freeNow")}{' '}<Link href="/app/publish/plan" className="font-bold text-vx-accent underline">{t("app.publish.composer.upgradeSchedule")}</Link>.
            </p>}

            {queuesEnabled && <div>
                <label htmlFor="publish-queue" className="text-sm font-bold mb-2 block">{t("app.publish.composer.queue")}</label>
                <div className="flex flex-wrap gap-3">
                    <select id="publish-queue" value={queueId} disabled={Boolean(submitting) || queues === null} onChange={(e) => { const id=e.target.value;setQueueId(id);const queue=(queues||[]).find((item)=>item.id===id);if(queue)setSelectedAccountIds(new Set(queue.account_ids.filter((accountId)=>activeAccounts.some((account)=>account.id===accountId)))); }} className="rounded-lg border border-vx-border bg-transparent px-3 py-2 text-sm">
                        <option value="">{queues===null?t("app.publish.composer.queuesLoading"):queues.length?t("app.publish.composer.queueChoose"):t("app.publish.composer.queuesEmpty")}</option>
                        {(queues||[]).map((queue)=><option key={queue.id} value={queue.id}>{queue.name}</option>)}
                    </select>
                    <Link href="/app/publish/queues" className="self-center text-sm font-bold text-vx-accent underline">{t("app.publish.composer.queuesManage")}</Link>
                </div>
                <p className="mt-2 text-xs text-vx-fg-muted">{t("app.publish.composer.queueInfo")}</p>
            </div>}

            {approvalsEnabled && <div className="rounded-xl border border-vx-border p-4">
                <label htmlFor="publish-reviewers" className="text-sm font-bold mb-2 block">{t("app.publish.composer.reviewers")}</label>
                <textarea id="publish-reviewers" data-testid="publish-reviewers" rows={2} value={reviewerEmails} onChange={(event) => setReviewerEmails(event.target.value)} className="w-full rounded-lg border border-vx-border bg-transparent px-3 py-2 text-sm" placeholder={t("app.publish.composer.reviewerExamples")} />
                <div className="mt-3 flex flex-wrap items-center gap-3"><label htmlFor="publish-approval-policy" className="text-sm font-bold">{t("app.publish.composer.approvalRule")}</label><select id="publish-approval-policy" value={approvalPolicy} onChange={(event) => setApprovalPolicy(event.target.value)} className="rounded-lg border border-vx-border bg-transparent px-3 py-2 text-sm"><option value="all">{t("app.publish.composer.everyone")}</option><option value="any">{t("app.publish.composer.anyone")}</option></select></div>
                <p className="mt-2 text-xs text-vx-fg-muted">{t("app.publish.composer.reviewersInfo")}</p>
            </div>}

            {error && <p role="alert" className="text-sm text-vx-danger">{error}</p>}
            {success && <p data-testid="publish-success" className="text-sm text-vx-accent">{success}</p>}
            {reviewLinks.length > 0 && <ul aria-label={t("app.publish.composer.reviewLinks")} className="space-y-2 rounded-xl border border-vx-border p-3">{reviewLinks.map((link) => <li key={link.email} className="flex flex-wrap items-center justify-between gap-2 text-sm"><span className="font-bold">{link.email}</span><button type="button" className={button} onClick={() => navigator.clipboard.writeText(link.url)}>{t("app.publish.composer.copyReviewLink")}</button></li>)}</ul>}

            <div className="flex flex-wrap gap-3">
                <button data-testid="publish-submit-now" type="submit" value="now" formNoValidate disabled={submitting || loadingMedia || uploading || !activeAccounts.length} className={primaryButton}>
                    {submitting === 'now' ? t("cinema.creatorApplication.submitting") : t("publish.plan.rowPostNow")}
                </button>
                {scheduleEnabled && <button data-testid="publish-submit-schedule" type="submit" value="schedule" disabled={submitting || loadingMedia || uploading || !activeAccounts.length} className={button}>
                    {submitting === 'schedule' ? t("app.publish.composer.scheduling") : t("app.publish.composer.schedulePost")}
                </button>}
                {queuesEnabled && <button data-testid="publish-submit-queue" type="submit" value="queue" formNoValidate disabled={submitting || loadingMedia || uploading || !activeAccounts.length || !queueId} className={button}>
                    {submitting === 'queue' ? t("app.publish.composer.adding") : t("app.publish.composer.addToQueue")}
                </button>}
                {approvalsEnabled && <button data-testid="publish-submit-review" type="submit" value="review" disabled={submitting || loadingMedia || uploading || !activeAccounts.length} className={button}>
                    {submitting === 'review' ? t("app.publish.composer.creatingReview") : t("app.publish.composer.sendForApproval")}
                </button>}
            </div>
            <p className="text-xs text-vx-fg-muted">{t("app.publish.composer.nowInfo")}{scheduleEnabled ? t("app.publish.composer.scheduleInfo") : ''}{' '}{t("app.publish.composer.publishingTime")}</p>
        </form>
    );
}

// 'delivered' (TikTok's MEDIA_UPLOAD outcome, ADR-0061 Phase 5) means the
// content reached the creator's TikTok inbox as a draft — not itself a
// live post, so it gets its own honest label rather than reading as
// "published".


function TargetBadge({ target }) {
  const { t } = useI18n();
    const tone = target.publish_status === 'published' || target.publish_status === 'delivered' ? 'text-vx-accent'
        : target.publish_status === 'failed' ? 'text-vx-danger' : 'text-vx-fg-muted';
    return (
        <span className={`inline-flex items-center gap-1.5 text-xs font-bold ${tone}`} title={target.last_error || ''}>
            <NetworkLogo network={target.network} className="h-3.5 w-3.5" />
            {tOr(t, `app.publish.network.${target.network}`, networkLabel(target.network))}: {tOr(t, `app.publish.composer.status.${target.publish_status}`, target.publish_status)}
            {target.platform_post_url && target.publish_status === 'published' && (
                <> · <a href={target.platform_post_url} target="_blank" rel="noreferrer" className="underline">{t("app.publish.composer.view")}</a></>
            )}
        </span>
    );
}

export function ScheduledPosts({ refreshToken, scheduleEnabled = true, onReuse }) {
  const { t, locale } = useI18n();
    const [posts, setPosts] = useState(null);
    const [query, setQuery] = useState('');
    const [calendarOpen, setCalendarOpen] = useState(false);
    const [loadError, setLoadError] = useState('');

    const load = useCallback(async () => {
        setLoadError('');
        try {
            const res = await listSocialPosts({ limit: 50 });
            setPosts(res.posts || []);
            setCalendarOpen(res.calendarEnabled === true);
        } catch {
            setLoadError(t("app.publish.composer.postsLoad"));
        }
    }, [t]);
    useEffect(() => { load(); }, [load, refreshToken]);

    if (loadError) return <p role="alert" className="text-sm text-vx-danger">{loadError}</p>;
    if (posts === null) return <p className="text-sm text-vx-fg-muted">{t("cinema.titlePage.loading")}</p>;

    const visible = posts.filter((post) => !query || `${post.global_text || ''} ${(post.targets || []).map((target) => networkLabel(target.network)).join(' ')}`.toLowerCase().includes(query.toLowerCase()));
    return (
        <div>
        <div className="mb-4 flex flex-wrap items-center gap-3">
            {calendarOpen && scheduleEnabled && <Link href="/app/publish/calendar" className="text-sm text-vx-accent underline">{t("app.publish.composer.openCalendar")}</Link>}
            {scheduleEnabled && posts.length > 0 && <label className="ms-auto text-sm"><span className="sr-only">{t("app.publish.composer.searchPosts")}</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("app.publish.composer.searchPosts")} className="rounded-full border border-vx-border bg-transparent px-4 py-2 text-sm" /></label>}
        </div>
        {posts.length === 0 && <p className="text-sm text-vx-fg-muted">{t("app.publish.composer.postsEmpty")}</p>}
        {posts.length > 0 && visible.length === 0 && <p className="text-sm text-vx-fg-muted">{t("app.publish.composer.noMatches")}</p>}
        <ul className="space-y-3">
            {visible.map((p) => (
                <li key={p.id} className="rounded-xl border border-vx-border p-3">
                    <div className="flex items-center justify-between gap-3 mb-2">
                        <span className="text-xs font-bold text-vx-fg-muted">
                            {tOr(t, `app.publish.composer.status.${p.status}`, p.status)} · {new Date(p.scheduled_at).toLocaleString(localeTag(locale))}
                        </span>
                        {scheduleEnabled && onReuse && (p.media || []).length > 0 && <button type="button" className={button} onClick={() => onReuse?.(p)}>{t("app.publish.composer.reuse")}</button>}
                    </div>
                    {p.global_text && <p className="text-sm text-vx-fg mb-2 line-clamp-2">{p.global_text}</p>}
                    <div className="flex flex-wrap gap-x-3 gap-y-1">
                        {(p.targets || []).map((target) => <TargetBadge key={target.id} target={target} />)}
                    </div>
                </li>
            ))}
        </ul>
        </div>
    );
}
